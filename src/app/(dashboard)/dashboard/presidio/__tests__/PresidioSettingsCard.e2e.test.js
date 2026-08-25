/**
 * E2E Tests for Presidio Settings Workflow
 *
 * Tests the complete user flow for:
 * - Loading Presidio settings
 * - Toggling Presidio sidecar
 * - Configuring child toggles
 * - Editing YAML configuration
 * - Saving and validating changes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import PresidioSettingsCard from '../PresidioSettingsCard';

// Mock the API functions
vi.mock('../lib/presidioApi', () => ({
  getPresidioSettings: vi.fn(),
  updatePresidioSettings: vi.fn(),
  validateYamlLocally: vi.fn(),
  debounce: (fn) => fn,
}));

import { getPresidioSettings, updatePresidioSettings, validateYamlLocally } from '../lib/presidioApi';

describe('Presidio Settings E2E Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Load', () => {
    it('should display loading state initially', () => {
      getPresidioSettings.mockImplementation(() => new Promise(() => {}));

      render(<PresidioSettingsCard />);

      expect(screen.getByText(/loading settings/i)).toBeInTheDocument();
    });

    it('should load and display initial settings', async () => {
      const mockSettings = {
        enabled: false,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
      };

      getPresidioSettings.mockResolvedValue(mockSettings);

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.queryByText(/loading settings/i)).not.toBeInTheDocument();
      });

      expect(screen.getByText('Presidio Sidecar')).toBeInTheDocument();
      expect(screen.getByText('Enable PII redaction middleware')).toBeInTheDocument();
    });

    it('should display error state on load failure', async () => {
      getPresidioSettings.mockRejectedValue(new Error('Failed to fetch settings'));

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByText(/failed to fetch settings/i)).toBeInTheDocument();
      });
    });
  });

  describe('Master Toggle (Presidio Sidecar)', () => {
    it('should enable Presidio sidecar when toggle is clicked', async () => {
      getPresidioSettings.mockResolvedValue({
        enabled: false,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
      });

      updatePresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
      });

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /presidio sidecar/i })).toBeInTheDocument();
      });

      const toggle = screen.getByRole('switch', { name: /presidio sidecar/i });
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(toggle);

      // Wait for state update
      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should show child controls when Presidio is enabled', async () => {
      getPresidioSettings.mockResolvedValue({
        enabled: false,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
      });

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByText('Presidio Sidecar')).toBeInTheDocument();
      });

      // Child controls should not be visible
      expect(screen.queryByText('PII Redaction')).not.toBeInTheDocument();

      // Enable Presidio
      const toggle = screen.getByRole('switch', { name: /presidio sidecar/i });
      fireEvent.click(toggle);

      // Child controls should now be visible
      await waitFor(() => {
        expect(screen.getByText('PII Redaction')).toBeInTheDocument();
        expect(screen.getByText('Custom Regex Patterns')).toBeInTheDocument();
      });
    });

    it('should hide child controls when Presidio is disabled', async () => {
      getPresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: true,
        customRegex: false,
        yamlContent: '',
      });

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByText('PII Redaction')).toBeInTheDocument();
      });

      // Disable Presidio
      const toggle = screen.getByRole('switch', { name: /presidio sidecar/i });
      fireEvent.click(toggle);

      // Child controls should be hidden
      await waitFor(() => {
        expect(screen.queryByText('PII Redaction')).not.toBeInTheDocument();
      });
    });
  });

  describe('Child Toggles', () => {
    beforeEach(async () => {
      getPresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
      });
    });

    it('should toggle PII redaction', async () => {
      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByText('PII Redaction')).toBeInTheDocument();
      });

      const toggle = screen.getAllByRole('switch')[1]; // Second toggle is PII Redaction
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(toggle);

      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should toggle custom regex', async () => {
      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByText('Custom Regex Patterns')).toBeInTheDocument();
      });

      const toggle = screen.getAllByRole('switch')[2]; // Third toggle is Custom Regex
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(toggle);

      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-checked', 'true');
      });
    });

    it('should show YAML editor when custom regex is enabled', async () => {
      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByText('Custom Regex Patterns')).toBeInTheDocument();
      });

      // YAML editor should not be visible
      expect(screen.queryByPlaceholderText(/Presidio Redaction Configuration/i)).not.toBeInTheDocument();

      // Enable custom regex
      const toggle = screen.getAllByRole('switch')[2];
      fireEvent.click(toggle);

      // YAML editor should now be visible
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Presidio Redaction Configuration/i)).toBeInTheDocument();
      });
    });
  });

  describe('YAML Editor', () => {
    beforeEach(async () => {
      getPresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: `rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\S+@\\S+"
    description: "Email pattern"`,
      });

      validateYamlLocally.mockReturnValue({ valid: true });
    });

    it('should display initial YAML content', async () => {
      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Presidio Redaction Configuration/i)).toBeInTheDocument();
      });

      const textarea = screen.getByPlaceholderText(/Presidio Redaction Configuration/i);
      expect(textarea).toHaveValue(
        expect.stringContaining('rules:')
      );
    });

    it('should validate YAML on change', async () => {
      const user = userEvent.setup();

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Presidio Redaction Configuration/i)).toBeInTheDocument();
      });

      const textarea = screen.getByPlaceholderText(/Presidio Redaction Configuration/i);

      // Type valid YAML
      await user.type(textarea, '\n  - entity: "PHONE"\n    pattern: "\\d+"');

      await waitFor(() => {
        expect(validateYamlLocally).toHaveBeenCalled();
      });

      expect(screen.getByText(/valid/i)).toBeInTheDocument();
    });

    it('should show validation error for invalid YAML', async () => {
      const user = userEvent.setup();

      validateYamlLocally.mockReturnValue({
        valid: false,
        error: 'Missing rules array'
      });

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Presidio Redaction Configuration/i)).toBeInTheDocument();
      });

      const textarea = screen.getByPlaceholderText(/Presidio Redaction Configuration/i);

      await user.clear(textarea);
      await user.type(textarea, 'invalid: yaml');

      await waitFor(() => {
        expect(screen.getByText(/missing rules array/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/valid/i)).not.toBeInTheDocument();
    });
  });

  describe('Save Workflow', () => {
    it('should save toggle changes successfully', async () => {
      getPresidioSettings.mockResolvedValue({
        enabled: false,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
      });

      updatePresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: true,
        customRegex: false,
        yamlContent: '',
      });

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /presidio sidecar/i })).toBeInTheDocument();
      });

      // Enable Presidio
      fireEvent.click(screen.getByRole('switch', { name: /presidio sidecar/i }));

      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /pii redaction/i })).toBeInTheDocument();
      });

      // Enable PII Redaction
      fireEvent.click(screen.getByRole('switch', { name: /pii redaction/i }));

      // Click save
      const saveButton = await screen.findByRole('button', { name: /save changes/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(updatePresidioSettings).toHaveBeenCalledWith({
          enabled: true,
          piiRedaction: true,
          customRegex: false,
        });
      });

      expect(screen.getByText(/saved/i)).toBeInTheDocument();
    });

    it('should save YAML configuration', async () => {
      const user = userEvent.setup();

      getPresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: '',
      });

      updatePresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: 'rules:\n  - entity: "TEST"',
      });

      validateYamlLocally.mockReturnValue({ valid: true });

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Presidio Redaction Configuration/i)).toBeInTheDocument();
      });

      const textarea = screen.getByPlaceholderText(/Presidio Redaction Configuration/i);
      await user.type(textarea, 'rules:\n  - entity: "TEST"');

      // Click save
      const saveButton = await screen.findByRole('button', { name: /save configuration/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(updatePresidioSettings).toHaveBeenCalledWith({
          enabled: true,
          piiRedaction: true,
          customRegex: true,
          yamlContent: expect.stringContaining('rules:'),
        });
      });
    });

    it('should not save when validation fails', async () => {
      const user = userEvent.setup();

      getPresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: '',
      });

      validateYamlLocally.mockReturnValue({
        valid: false,
        error: 'Invalid YAML'
      });

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Presidio Redaction Configuration/i)).toBeInTheDocument();
      });

      const textarea = screen.getByPlaceholderText(/Presidio Redaction Configuration/i);
      await user.clear(textarea);
      await user.type(textarea, 'invalid: [');

      await waitFor(() => {
        expect(screen.getByText(/invalid yaml/i)).toBeInTheDocument();
      });

      // Save button should be disabled
      const saveButton = screen.queryByRole('button', { name: /save configuration/i });
      expect(saveButton).toBeDisabled();
    });

    it('should handle save errors', async () => {
      getPresidioSettings.mockResolvedValue({
        enabled: false,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
      });

      updatePresidioSettings.mockRejectedValue(new Error('Network error'));

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /presidio sidecar/i })).toBeInTheDocument();
      });

      // Enable Presidio
      fireEvent.click(screen.getByRole('switch', { name: /presidio sidecar/i }));

      // Click save
      const saveButton = await screen.findByRole('button', { name: /save changes/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/failed/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  describe('Full User Flow', () => {
    it('should complete full workflow: enable → configure → save', async () => {
      const user = userEvent.setup();

      // Initial state: everything disabled
      getPresidioSettings.mockResolvedValue({
        enabled: false,
        piiRedaction: false,
        customRegex: false,
        yamlContent: '',
      });

      // Mock successful updates
      updatePresidioSettings
        .mockResolvedValueOnce({ enabled: true, piiRedaction: false, customRegex: false, yamlContent: '' })
        .mockResolvedValueOnce({ enabled: true, piiRedaction: true, customRegex: false, yamlContent: '' })
        .mockResolvedValueOnce({ enabled: true, piiRedaction: true, customRegex: true, yamlContent: '' })
        .mockResolvedValueOnce({
          enabled: true,
          piiRedaction: true,
          customRegex: true,
          yamlContent: 'rules:\n  - entity: "TEST"',
        });

      validateYamlLocally.mockReturnValue({ valid: true });

      render(<PresidioSettingsCard />);

      // Step 1: Enable Presidio
      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /presidio sidecar/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('switch', { name: /presidio sidecar/i }));

      // Step 2: Enable PII Redaction
      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /pii redaction/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('switch', { name: /pii redaction/i }));

      // Step 3: Enable Custom Regex
      fireEvent.click(screen.getByRole('switch', { name: /custom regex patterns/i }));

      // Step 4: Edit YAML
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Presidio Redaction Configuration/i)).toBeInTheDocument();
      });

      const textarea = screen.getByPlaceholderText(/Presidio Redaction Configuration/i);
      await user.type(textarea, 'rules:\n  - entity: "TEST"');

      // Step 5: Save
      const saveButton = await screen.findByRole('button', { name: /save configuration/i });
      fireEvent.click(saveButton);

      // Verify save succeeded
      await waitFor(() => {
        expect(screen.getByText(/saved/i)).toBeInTheDocument();
      });

      // Verify all settings were saved
      expect(updatePresidioSettings).toHaveBeenCalledWith({
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: expect.stringContaining('rules:'),
      });
    });

    it('should maintain state across interactions', async () => {
      getPresidioSettings.mockResolvedValue({
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: 'rules:\n  - entity: "TEST"',
      });

      render(<PresidioSettingsCard />);

      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /presidio sidecar/i })).toBeInTheDocument();
      });

      // All controls should be in initial state
      expect(screen.getByRole('switch', { name: /presidio sidecar/i })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: /pii redaction/i })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: /custom regex patterns/i })).toHaveAttribute('aria-checked', 'true');

      // Toggle PII off
      fireEvent.click(screen.getByRole('switch', { name: /pii redaction/i }));

      // PII should be off, others unchanged
      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /pii redaction/i })).toHaveAttribute('aria-checked', 'false');
      });
      expect(screen.getByRole('switch', { name: /presidio sidecar/i })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: /custom regex patterns/i })).toHaveAttribute('aria-checked', 'true');
    });
  });
});
