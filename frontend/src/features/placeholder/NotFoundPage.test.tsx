import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/renderWithProviders';
import { NotFoundPage } from './NotFoundPage';

/**
 * What a dead URL says.
 *
 * Before S6 the catch-all route was `<Navigate to="/" replace />`: a stale
 * bookmark, a typo and a link from a chat message all silently rewrote the
 * address bar and landed on the dashboard. These assert the replacement tells
 * the user what happened and gives them somewhere to go.
 */

describe('NotFoundPage', () => {
  it('says the address does not exist rather than redirecting away from it', () => {
    renderWithProviders(<NotFoundPage />, '/tickets/typo-here');

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('There is nothing at this address');
  });

  it('shows the path that failed, because that is what identifies the typo', () => {
    renderWithProviders(<NotFoundPage />, '/enginers');

    expect(screen.getByText('/enginers')).toBeInTheDocument();
  });

  it('offers somewhere to go rather than leaving a dead end', () => {
    renderWithProviders(<NotFoundPage />, '/nope');

    expect(screen.getByRole('link', { name: 'Go to your home page' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Browse all tickets' })).toHaveAttribute(
      'href',
      '/tickets',
    );
  });
});
