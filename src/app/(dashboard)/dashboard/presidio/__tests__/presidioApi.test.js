/**
 * Unit tests for Presidio API client functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPresidioSettings,
  updatePresidioSettings,
  validateYamlLocally,
  debounce,
  usePresidioSettings,
} from '../lib/presidioApi.js';

// Mock fetch
global.fetch = vi.fn();

describe('getPresidioSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch Presidio settings successfully', async () => {
    const mockResponse = {
      success: true,
      data: {
        enabled: true,
        piiRedaction: true,
        customRegex: false,
        yamlContent: 'rules:\n  - entity: "TEST"',
        yamlPath: '/app/config/redaction_config.yaml',
        updatedAt: '2026-08-25T14:30:00.000Z',
      },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await getPresidioSettings();

    expect(result.enabled).toBe(true);
    expect(result.piiRedaction).toBe(true);
    expect(result.customRegex).toBe(false);
    expect(result.yamlContent).toBe('rules:\n  - entity: "TEST"');
    expect(result.yamlPath).toBe('/app/config/redaction_config.yaml');
    expect(result.updatedAt).toBe('2026-08-25T14:30:00.000Z');
    expect(global.fetch).toHaveBeenCalledWith('/api/settings/presidio', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
  });

  it('should handle HTTP error responses', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({
        success: false,
        error: { message: 'Server error' },
      }),
    });

    await expect(getPresidioSettings()).rejects.toThrow('Server error');
  });

  it('should handle API error responses', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: false,
        error: { message: 'Configuration not found' },
      }),
    });

    await expect(getPresidioSettings()).rejects.toThrow('Configuration not found');
  });

  it('should handle empty yamlContent', async () => {
    const mockResponse = {
      success: true,
      data: {
        enabled: false,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
        yamlPath: '/app/config/redaction_config.yaml',
      },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await getPresidioSettings();

    expect(result.yamlContent).toBe('');
  });
});

describe('updatePresidioSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update toggle states without YAML', async () => {
    const mockResponse = {
      success: true,
      data: {
        enabled: true,
        piiRedaction: true,
        customRegex: false,
        yamlContent: 'rules:\n  - entity: "TEST"',
        yamlPath: '/app/config/redaction_config.yaml',
        updatedAt: '2026-08-25T14:35:00.000Z',
      },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await updatePresidioSettings({
      enabled: true,
      piiRedaction: true,
      customRegex: false,
    });

    expect(result.enabled).toBe(true);
    expect(result.updatedAt).toBe('2026-08-25T14:35:00.000Z');

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody).not.toHaveProperty('yamlContent');
  });

  it('should include YAML when customRegex is true', async () => {
    const mockResponse = {
      success: true,
      data: {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: 'rules:\n  - entity: "NEW_PATTERN"',
        yamlPath: '/app/config/redaction_config.yaml',
        updatedAt: '2026-08-25T14:35:00.000Z',
      },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const yamlContent = 'rules:\n  - entity: "NEW_PATTERN"';

    const result = await updatePresidioSettings({
      enabled: true,
      piiRedaction: true,
      customRegex: true,
      yamlContent,
    });

    expect(result.yamlContent).toBe(yamlContent);

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestBody.yamlContent).toBe(yamlContent);
  });

  it('should handle validation errors', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: false,
        error: {
          message: 'YAML structure validation failed',
          details: 'Missing rules array',
        },
      }),
    });

    await expect(
      updatePresidioSettings({
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: 'invalid: yaml',
      })
    ).rejects.toThrow('Missing rules array');
  });

  it('should handle network errors', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      updatePresidioSettings({
        enabled: true,
        piiRedaction: false,
        customRegex: false,
      })
    ).rejects.toThrow('Network error');
  });
});

describe('validateYamlLocally', () => {
  it('should validate valid YAML with rules', () => {
    const yaml = `rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\\\S+@\\\\S+"
    description: "Email pattern"`;

    const result = validateYamlLocally(yaml);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should validate empty YAML', () => {
    const result = validateYamlLocally('');

    expect(result.valid).toBe(true);
  });

  it('should reject YAML without rules key', () => {
    const yaml = `config:
  someSetting: value`;

    const result = validateYamlLocally(yaml);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('rules');
  });

  it('should handle parse errors', () => {
    const yaml = `invalid: yaml: [unclosed`;

    const result = validateYamlLocally(yaml);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('debounce', () => {
  it('should debounce function calls', async () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn('arg1');
    debouncedFn('arg2');
    debouncedFn('arg3');

    // Should not have been called yet
    expect(mockFn).not.toHaveBeenCalled();

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should have been called once with last arguments
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith('arg3');
  });

  it('should cancel previous debounce', async () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn('first');
    await new Promise((resolve) => setTimeout(resolve, 50));
    debouncedFn('second');

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith('second');
  });
});

describe('usePresidioSettings hook', () => {
  let React;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock React
    React = require('react');
    vi.spyOn(React, 'useState').mockImplementation((initial) => [initial, vi.fn()]);
    vi.spyOn(React, 'useCallback').mockImplementation((fn) => fn);
    vi.spyOn(React, 'useEffect').mockImplementation((fn) => fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should auto-fetch settings on mount', async () => {
    const mockResponse = {
      success: true,
      data: {
        enabled: true,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
        yamlPath: '/app/config/redaction_config.yaml',
      },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { settings, isLoading } = usePresidioSettings({ autoFetch: true });

    expect(global.fetch).toHaveBeenCalled();
    expect(settings).toBeDefined();
  });

  it('should not auto-fetch when disabled', () => {
    const { settings } = usePresidioSettings({ autoFetch: false });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(settings).toBeDefined();
  });

  it('should handle fetch errors', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Fetch failed'));

    const { error } = usePresidioSettings({ autoFetch: true });

    expect(error).toBeDefined();
    expect(error.message).toBe('Fetch failed');
  });
});

describe('Integration scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full fetch-update cycle', async () => {
    // Mock fetch
    const getResponse = {
      success: true,
      data: {
        enabled: false,
        piiRedaction: false,
        customRegex: false,
        yamlContent: 'rules:\n  - entity: "TEST"',
        yamlPath: '/app/config/redaction_config.yaml',
      },
    };

    const updateResponse = {
      success: true,
      data: {
        ...getResponse.data,
        enabled: true,
        updatedAt: '2026-08-25T14:40:00.000Z',
      },
    };

    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => getResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => updateResponse,
      });

    // Fetch
    const settings = await getPresidioSettings();
    expect(settings.enabled).toBe(false);

    // Update
    const updated = await updatePresidioSettings({
      enabled: true,
      piiRedaction: false,
      customRegex: false,
    });

    expect(updated.enabled).toBe(true);
    expect(updated.updatedAt).toBe('2026-08-25T14:40:00.000Z');
  });

  it('should validate before update', async () => {
    const invalidYaml = 'invalid: yaml: [unclosed';

    const validation = validateYamlLocally(invalidYaml);
    expect(validation.valid).toBe(false);

    // Should not call API if validation fails
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });

    try {
      await updatePresidioSettings({
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: invalidYaml,
      });
    } catch (error) {
      // Expected to fail on server-side validation
    }
  });
});
