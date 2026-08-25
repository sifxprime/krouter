"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import { getPresidioSettings, updatePresidioSettings, validateYamlLocally, debounce } from "./lib/presidioApi";

/**
 * PresidioSettingsCard Component
 *
 * Manages Presidio PII redaction settings with:
 * - Master toggle for Presidio sidecar
 * - Child toggles for PII redaction and custom regex
 * - YAML editor for custom regex patterns
 * - Real-time validation and hot-reload support
 */
export default function PresidioSettingsCard() {
  // State
  const [settings, setSettings] = useState({
    enabled: false,
    piiRedaction: false,
    customRegex: false,
    yamlContent: '',
  });
  const [yamlContent, setYamlContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle, success, error

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getPresidioSettings();
      setSettings({
        enabled: data.enabled,
        piiRedaction: data.piiRedaction,
        customRegex: data.customRegex,
        yamlContent: data.yamlContent || '',
      });
      setYamlContent(data.yamlContent || '');
    } catch (err) {
      setError(err.message);
      console.error('Failed to load Presidio settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced YAML validation
  const validateYamlDebounced = useCallback(
    debounce((content) => {
      const validation = validateYamlLocally(content);
      setValidationError(validation.valid ? null : validation.error);
    }, 500),
    []
  );

  // Handle YAML content changes
  const handleYamlChange = (e) => {
    const newContent = e.target.value;
    setYamlContent(newContent);
    setSettings(prev => ({ ...prev, yamlContent: newContent }));
    validateYamlDebounced(newContent);
  };

  // Handle toggle changes
  const handleToggleChange = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Save settings
  const handleSave = async () => {
    if (validationError) {
      setError('Please fix validation errors before saving');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await updatePresidioSettings({
        enabled: settings.enabled,
        piiRedaction: settings.piiRedaction,
        customRegex: settings.customRegex,
        yamlContent: settings.customRegex ? yamlContent : undefined,
      });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      setError(err.message);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
      console.error('Failed to save Presidio settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Check if settings have changed
  const hasChanges = () => {
    return (
      settings.enabled !== (settings.originalEnabled ?? false) ||
      settings.piiRedaction !== (settings.originalPiiRedaction ?? false) ||
      settings.customRegex !== (settings.originalCustomRegex ?? false) ||
      (settings.customRegex && yamlContent !== settings.originalYamlContent)
    );
  };

  // Track original values for change detection
  useEffect(() => {
    if (!isLoading) {
      setSettings(prev => ({
        ...prev,
        originalEnabled: prev.enabled,
        originalPiiRedaction: prev.piiRedaction,
        originalCustomRegex: prev.customRegex,
        originalYamlContent: prev.yamlContent,
      }));
    }
  }, [isLoading]);

  return (
    <Card
      title="Presidio Settings"
      subtitle="Configure PII redaction using Microsoft Presidio"
      icon="security"
    >
      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8 text-text-muted">
          <span className="material-symbols-outlined animate-spin mr-2">refresh</span>
          Loading settings...
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mb-4 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-lg">error</span>
            {error}
          </div>
        </div>
      )}

      {/* Settings Content */}
      {!isLoading && (
        <div className="space-y-4">
          {/* Main Toggle - Presidio Sidecar */}
          <Card.ListItem>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-main">Presidio Sidecar</span>
                {settings.enabled && (
                  <span className="px-2 py-0.5 text-xs bg-success/20 text-success rounded-full">Active</span>
                )}
              </div>
              <p className="text-sm text-text-muted mt-0.5">
                Enable PII redaction middleware
              </p>
            </div>
            <ToggleSwitch
              checked={settings.enabled}
              onChange={() => handleToggleChange('enabled')}
              disabled={isSaving}
            />
          </Card.ListItem>

          {/* Child Controls - Only visible when main toggle is on */}
          {settings.enabled && (
            <div className="ml-4 pl-4 border-l-2 border-border-subtle space-y-4">
              {/* PII Redaction Toggle */}
              <Card.ListItem>
                <div>
                  <div className="font-medium text-text-main">PII Redaction</div>
                  <p className="text-sm text-text-muted mt-0.5">
                    Redact PII from messages using Presidio
                  </p>
                </div>
                <ToggleSwitch
                  checked={settings.piiRedaction}
                  onChange={() => handleToggleChange('piiRedaction')}
                  disabled={isSaving}
                />
              </Card.ListItem>

              {/* Custom Regex Toggle */}
              <Card.ListItem>
                <div>
                  <div className="font-medium text-text-main">Custom Regex Patterns</div>
                  <p className="text-sm text-text-muted mt-0.5">
                    Use custom regex patterns from YAML config
                  </p>
                </div>
                <ToggleSwitch
                  checked={settings.customRegex}
                  onChange={() => handleToggleChange('customRegex')}
                  disabled={isSaving}
                />
              </Card.ListItem>

              {/* YAML Editor - Only visible when custom regex is enabled */}
              {settings.customRegex && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-text-main">
                      Custom Regex Patterns
                    </label>
                    {validationError ? (
                      <span className="flex items-center gap-1 text-xs text-error">
                        <span className="material-symbols-outlined text-sm">error</span>
                        {validationError}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        Valid
                      </span>
                    )}
                  </div>
                  <textarea
                    value={yamlContent}
                    onChange={handleYamlChange}
                    className="w-full h-64 p-4 font-mono text-sm bg-bg border border-border-subtle rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="# Presidio Redaction Configuration&#10;rules:&#10;  - entity: &quot;EMAIL_REGEX&quot;&#10;    pattern: &quot;\\S+@\\S+&quot;&#10;    description: &quot;Email pattern&quot;"
                    spellCheck={false}
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={handleSave}
                      disabled={isSaving || !!validationError}
                      className={`
                        px-4 py-2 rounded-lg font-medium text-sm transition-all
                        ${isSaving
                          ? 'bg-text-muted text-text-muted-foreground cursor-not-allowed'
                          : saveStatus === 'success'
                            ? 'bg-success text-white'
                            : saveStatus === 'error'
                              ? 'bg-error text-white'
                              : validationError
                                ? 'bg-text-muted text-text-muted-foreground cursor-not-allowed'
                                : 'bg-primary text-white hover:bg-primary/90'
                        }
                      `}
                    >
                      {isSaving ? (
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                          Saving...
                        </span>
                      ) : saveStatus === 'success' ? (
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm">check</span>
                          Saved
                        </span>
                      ) : saveStatus === 'error' ? (
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm">close</span>
                          Failed
                        </span>
                      ) : (
                        'Save Configuration'
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Save Button for Toggle Changes */}
          {settings.enabled && !settings.customRegex && (
            <div className="flex justify-end pt-4 border-t border-border-subtle">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Toggle Switch Component
 *
 * A simple accessible toggle switch component
 */
function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`
        relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2
        ${checked ? 'bg-primary' : 'bg-surface-3'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
          transition duration-200 ease-in-out
          ${checked ? 'translate-x-5' : 'translate-x-0'}
        `}
      />
    </button>
  );
}
