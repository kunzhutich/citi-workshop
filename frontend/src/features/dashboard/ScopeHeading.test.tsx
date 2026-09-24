import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/renderWithProviders';
import { PeriodScopeHeading, ScopeLabel } from './ScopeHeading';

/**
 * The dated caption, and the one screen that is allowed to do without it.
 *
 * R7 removed "Counted over 24 Aug – 23 Sep 2026" from the engineer page,
 * where the date-range control now sits inside this very heading and says the
 * same thing. The admin dashboard has no such control beside its heading and
 * **must keep the sentence** — decision D14 part 1 is the entry about that
 * screen having one filter bar and two tenses under it, and D9 is why the
 * distinction exists at all.
 *
 * So the interesting assertion is a *pair*, and it is the pair that lives in
 * this file: with the flag, no caption; without it, the caption, because the
 * default is what every other caller gets. A test that only looked at the
 * engineer page would pass just as happily if the caption had been deleted
 * from the component for everybody — which is the shape of defect D24, D25,
 * D35 and D40 all turned out to be. `AdminDashboardPage.test.tsx` asserts the
 * same caption end to end, from a real response's `window`; this file asserts
 * the mechanism that decides whether it is drawn.
 */

const WINDOW = { from: '2026-08-24T00:00:00Z', to: '2026-09-23T00:00:00Z' };

describe('the dated caption under a period heading', () => {
  it('names the window by default, for every screen that asks for nothing else', () => {
    renderWithProviders(
      <PeriodScopeHeading
        title="Reported in this period"
        from={WINDOW.from}
        to={WINDOW.to}
        buildingName={null}
      />,
    );

    // The dash between the dates is locale punctuation, so the assertion is
    // on the two dates and the word in front of them.
    expect(screen.getByTestId('period-scope-heading').textContent).toMatch(
      /Counted over .*2026.* .*2026/,
    );
  });

  it('keeps naming the building it was narrowed to, which is not a date', () => {
    renderWithProviders(
      <PeriodScopeHeading
        title="Reported in this period"
        from={WINDOW.from}
        to={WINDOW.to}
        buildingName="SFO-1"
      />,
    );

    expect(screen.getByTestId('period-scope-heading')).toHaveTextContent('in SFO-1');
  });

  it('drops it, and only it, when the screen states its period another way', () => {
    renderWithProviders(
      <PeriodScopeHeading
        title="What they got through"
        from={WINDOW.from}
        to={WINDOW.to}
        buildingName={null}
        datesShownElsewhere
      />,
    );

    const heading = screen.getByTestId('period-scope-heading');
    expect(heading).not.toHaveTextContent(/Counted over/);
    expect(heading).not.toHaveTextContent(/2026/);
    // The title is not what was removed. Dropping the whole heading would
    // satisfy the two assertions above and is not what was asked for.
    expect(screen.getByRole('heading', { name: 'What they got through' })).toBeInTheDocument();
  });

  it('puts the scope label in the caption’s place, with one clock and not two', () => {
    renderWithProviders(
      <PeriodScopeHeading
        title="What they got through"
        from={WINDOW.from}
        to={WINDOW.to}
        buildingName={null}
        datesShownElsewhere
      />,
    );

    const heading = screen.getByTestId('period-scope-heading');
    expect(screen.getByTestId('scope-label-period')).toHaveTextContent('Over the selected period');
    // The label brings its own clock, so the heading must not also draw one.
    expect(within(heading).getAllByTestId('HistoryToggleOffIcon')).toHaveLength(1);
  });

  it('carries this section’s own controls at the end of the title row', () => {
    renderWithProviders(
      <PeriodScopeHeading
        title="What they got through"
        from={WINDOW.from}
        to={WINDOW.to}
        buildingName={null}
        datesShownElsewhere
        actions={<button type="button">Date range</button>}
      />,
    );

    const heading = screen.getByTestId('period-scope-heading');
    expect(within(heading).getByRole('button', { name: 'Date range' })).toBeInTheDocument();
  });
});

describe('the scope label', () => {
  it('says the same two words the dashboard headings say', () => {
    renderWithProviders(
      <>
        <ScopeLabel kind="current" />
        <ScopeLabel kind="period" />
      </>,
    );

    expect(screen.getByTestId('scope-label-current')).toHaveTextContent('Right now');
    expect(screen.getByTestId('scope-label-period')).toHaveTextContent('Over the selected period');
  });

  it('names no dates, having read none back off a response', () => {
    // D14 and D24: a period is only ever stated from the server's own
    // `window`. This label has no access to one, so it must not imply it has.
    renderWithProviders(<ScopeLabel kind="period" />);

    expect(screen.getByTestId('scope-label-period').textContent).not.toMatch(/\d/);
  });
});
