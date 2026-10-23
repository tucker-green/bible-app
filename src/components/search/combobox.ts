/**
 * Combobox wiring between the header's search field (the combobox, owned by Header.tsx) and the
 * search panel's result list (the listbox, owned by SearchPanel.tsx). Kept in a tiny module of its
 * own so the header can read it without importing the panel.
 *
 *   <input role="combobox" aria-controls={SEARCH_LISTBOX_ID} aria-autocomplete="list"
 *          aria-expanded={searchCombo.value.expanded}
 *          aria-activedescendant={searchCombo.value.activeId ?? undefined}>
 *
 * The panel keeps `searchCombo` up to date; keys typed in the field reach it via state.searchKeys.
 */
import { signal } from '@preact/signals';

/** id of the listbox holding every selectable result (go-to, book, people & places, verses). */
export const SEARCH_LISTBOX_ID = 'search-listbox';

export interface SearchComboState {
  /** The listbox is rendered and has at least one option. */
  expanded: boolean;
  /** id of the option the arrow keys moved to (aria-activedescendant), or null. */
  activeId: string | null;
}

export const searchCombo = signal<SearchComboState>({ expanded: false, activeId: null });
