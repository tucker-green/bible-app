/**
 * STUB — replaced by the search agent. Renders nothing unless state.searchOpen is true.
 * Reads the query from `searchQuery` (bound to the header field, id SEARCH_INPUT_ID).
 */
import { closeSearch, searchOpen, searchQuery } from '../../app/state';

export function SearchPanel() {
  if (!searchOpen.value) return null;
  return (
    <div id="search-panel" class="search-stub" role="region" aria-label="Search results" data-keep-word>
      <p>
        Search is coming soon{searchQuery.value ? <> — “{searchQuery.value}”</> : null}.
      </p>
      <button type="button" class="link-btn" onClick={closeSearch}>
        Close
      </button>
    </div>
  );
}
