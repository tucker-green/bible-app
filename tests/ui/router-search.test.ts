import { afterEach, describe, expect, it } from 'vitest';
import { startRouter } from '../../src/app/router';
import { route, searchOpen, searchQuery } from '../../src/app/state';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('router ↔ search panel', () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
    searchOpen.value = false;
    window.location.hash = '';
  });

  it('#/search opens the panel with the query; leaving the route (Back) closes it', async () => {
    window.location.hash = '#/KJV/JHN/1';
    stop = startRouter(window);
    expect(route.value.name).toBe('read');

    window.location.hash = '#/search?q=love';
    await tick();
    expect(route.value.name).toBe('search');
    expect(searchOpen.value).toBe(true);
    expect(searchQuery.value).toBe('love');

    window.location.hash = '#/KJV/JHN/1';
    await tick();
    expect(route.value.name).toBe('read');
    expect(searchOpen.value).toBe(false);
  });

  it('a panel opened from the reader (not by the route) stays open across chapter changes', async () => {
    window.location.hash = '#/KJV/JHN/1';
    stop = startRouter(window);
    searchOpen.value = true;
    window.location.hash = '#/KJV/JHN/2';
    await tick();
    expect(searchOpen.value).toBe(true);
  });
});
