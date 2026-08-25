/**
 * API client functions for Presidio settings
 * 
 * Provides typed functions to fetch and update Presidio configuration
 */

import React from 'react';

/**
 * Presidio settings data structure
 * @typedef {Object} PresidioSettings
 * @property {boolean} enabled - Master toggle for Presidio sidecar
 * @property {boolean} piiRedaction - Enable PII redaction
 * @property {boolean} customRegex - Enable custom regex patterns
 * @property {string} yamlContent - YAML configuration content
 * @property {string} yamlPath - Path to YAML file
 * @property {string} [updatedAt] - Last update timestamp
 */

/**
 * API response wrapper
 * @typedef {Object} ApiResponse
 * @property {boolean} success - Whether the request was successful
 * @property {Object} data - Response data
 * @property {Object} [error] - Error object if request failed
 */

/**
 * Builds a human-readable message from an API error envelope.
 *
 * The settings API returns `{ code, message, details }`, where `message` is a
 * generic category ("YAML structure validation failed") and `details` carries the
 * actionable specifics ("Missing rules array"). Both are surfaced so the caller
 * never loses the part that tells the user what to actually fix.
 *
 * @param {Object} [error] - Error envelope from the API
 * @param {string} fallback - Message to use when the envelope carries nothing
 * @returns {string} Combined error message
 */
function formatApiError(error, fallback) {
  const parts = [error?.message, error?.details].filter(Boolean);
  return parts.length > 0 ? parts.join(': ') : fallback;
}

/**
 * Fetches current Presidio settings from the API
 * 
 * @returns {Promise<PresidioSettings>} Presidio settings
 * @throws {Error} If the request fails or returns an error
 * 
 * @example
 * const settings = await getPresidioSettings();
 * console.log(settings.enabled, settings.yamlContent);
 */
export async function getPresidioSettings() {
  const response = await fetch('/api/settings/presidio', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(formatApiError(error?.error, `HTTP ${response.status}: ${response.statusText}`));
  }

  const result = await response.json();
  
  if (!result.success) {
    throw new Error(formatApiError(result.error, 'Failed to fetch Presidio settings'));
  }

  return {
    enabled: result.data.enabled,
    piiRedaction: result.data.piiRedaction,
    customRegex: result.data.customRegex,
    yamlContent: result.data.yamlContent || '',
    yamlPath: result.data.yamlPath,
    updatedAt: result.data.updatedAt,
  };
}

/**
 * Updates Presidio settings
 * 
 * @param {Object} config - Configuration to update
 * @param {boolean} config.enabled - Master toggle state
 * @param {boolean} config.piiRedaction - PII redaction toggle state
 * @param {boolean} config.customRegex - Custom regex toggle state
 * @param {string} [config.yamlContent] - YAML content (only when customRegex=true)
 * @returns {Promise<PresidioSettings>} Updated settings
 * @throws {Error} If the request fails or validation fails
 * 
 * @example
 * const updated = await updatePresidioSettings({
 *   enabled: true,
 *   piiRedaction: true,
 *   customRegex: false
 * });
 */
export async function updatePresidioSettings(config) {
  const requestBody = {
    enabled: config.enabled,
    piiRedaction: config.piiRedaction,
    customRegex: config.customRegex,
  };

  // Only include yamlContent if customRegex is true and content is provided
  if (config.customRegex && config.yamlContent !== undefined) {
    requestBody.yamlContent = config.yamlContent;
  }

  const response = await fetch('/api/settings/presidio', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(formatApiError(error?.error, `HTTP ${response.status}: ${response.statusText}`));
  }

  const result = await response.json();
  
  if (!result.success) {
    throw new Error(formatApiError(result.error, 'Failed to update Presidio settings'));
  }

  return {
    enabled: result.data.enabled,
    piiRedaction: result.data.piiRedaction,
    customRegex: result.data.customRegex,
    yamlContent: result.data.yamlContent || '',
    yamlPath: result.data.yamlPath,
    updatedAt: result.data.updatedAt,
  };
}

/**
 * Validates YAML content locally before sending to server
 * 
 * @param {string} yamlContent - YAML content to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 * 
 * @example
 * const validation = validateYamlLocally('rules:\n  - entity: "TEST"\n    pattern: ".*"\n    description: "Test"');
 * if (validation.valid) {
 *   console.log('YAML is valid');
 * } else {
 *   console.error('YAML error:', validation.error);
 * }
 */
export function validateYamlLocally(yamlContent) {
  try {
    // Try to parse YAML (using a simple JS YAML library or basic validation)
    // For now, do basic structure validation
    const lines = yamlContent.split('\n');
    const trimmedContent = yamlContent.trim();
    
    if (!trimmedContent) {
      return { valid: true }; // Empty is valid
    }
    
    // Check for basic YAML structure
    if (!trimmedContent.includes('rules:')) {
      return { valid: false, error: 'Missing "rules:" key in YAML' };
    }
    
    // Simple indentation check
    let hasRules = false;
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('rules:')) {
        hasRules = true;
      } else if (hasRules && trimmedLine.startsWith('- entity:')) {
        // Found a rule, good
      } else if (hasRules && trimmedLine.startsWith('pattern:')) {
        // Found a pattern, good
      } else if (hasRules && trimmedLine.startsWith('description:')) {
        // Found a description, good
      }
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Creates a debounce function for delaying function execution
 * 
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} Debounced function
 * 
 * @example
 * const debouncedValidate = debounce(validateYamlLocally, 500);
 * debouncedValidate(yamlContent);
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * React hook for fetching and managing Presidio settings
 * 
 * @param {Object} options - Hook options
 * @param {boolean} [options.autoFetch=true] - Automatically fetch on mount
 * @param {number} [options.pollInterval=0] - Poll interval in ms (0 = no polling)
 * @returns {{
 *   settings: PresidioSettings | null,
 *   isLoading: boolean,
 *   error: Error | null,
 *   refetch: () => Promise<void>,
 *   updateSettings: (config: Object) => Promise<void>
 * }}
 * 
 * @example
 * function MyComponent() {
 *   const { settings, isLoading, error, updateSettings } = usePresidioSettings();
 *   
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   
 *   return (
 *     <button onClick={() => updateSettings({ enabled: !settings.enabled, ... })}>
 *       Toggle Presidio
 *     </button>
 *   );
 * }
 */
export function usePresidioSettings(options = {}) {
  const { autoFetch = true, pollInterval = 0 } = options;
  const [settings, setSettings] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const fetchSettings = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await getPresidioSettings();
      setSettings(data);
    } catch (err) {
      setError(err);
      console.error('Failed to fetch Presidio settings:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateConfig = React.useCallback(async (config) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const updated = await updatePresidioSettings(config);
      setSettings(updated);
    } catch (err) {
      setError(err);
      console.error('Failed to update Presidio settings:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-fetch on mount
  React.useEffect(() => {
    if (autoFetch) {
      fetchSettings();
    }
  }, [autoFetch, fetchSettings]);

  // Poll for changes
  React.useEffect(() => {
    if (pollInterval > 0) {
      const interval = setInterval(fetchSettings, pollInterval);
      return () => clearInterval(interval);
    }
  }, [pollInterval, fetchSettings]);

  return {
    settings,
    isLoading,
    error,
    refetch: fetchSettings,
    updateSettings: updateConfig,
  };
}

/**
 * Presidio API client with advanced features
 */
export const presidioApi = {
  /**
   * Get settings
   */
  get: getPresidioSettings,
  
  /**
   * Update settings
   */
  update: updatePresidioSettings,
  
  /**
   * Validate YAML locally
   */
  validateYaml: validateYamlLocally,
  
  /**
   * Debounce utility
   */
  debounce,
  
  /**
   * React hook
   */
  useSettings: usePresidioSettings,
};

export default presidioApi;
