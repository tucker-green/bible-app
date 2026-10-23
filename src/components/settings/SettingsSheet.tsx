/**
 * STUB — replaced by the settings agent. Renders nothing unless state.settingsOpen is true.
 * See src/app/README.md for the settings / remote-translation API.
 */
import { closeSettings, settingsOpen, settingsSection } from '../../app/state';

export function SettingsSheet() {
  if (!settingsOpen.value) return null;
  return (
    <div class="settings-stub" role="dialog" aria-label="Settings">
      <p>Settings are coming soon{settingsSection.value ? ` (${settingsSection.value})` : ''}.</p>
      <button type="button" class="link-btn" onClick={closeSettings}>
        Close
      </button>
    </div>
  );
}
