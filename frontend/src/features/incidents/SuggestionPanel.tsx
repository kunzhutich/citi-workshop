import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import type { IncidentSuggestionQuery } from '../../api/incidents';
import type {
  LiveSuggestion,
  ResolvedSuggestion,
  SuggestionMatch,
  WatchState,
} from '../../api/types';
import { PriorityChip } from '../../components/PriorityChip';
import { RowActions } from '../../components/RowActions';
import { useSnackbar } from '../../components/SnackbarContext';
import { StatusChip } from '../../components/StatusChip';
import { TicketTitle } from '../../components/TicketTitle';
import { seatFieldLabel } from '../../display/labels';
import { relativeTime } from '../../display/time';
import { incidentPath } from '../../routes';
import { useIncidentSuggestions, useSetWatching } from './hooks';
import type { LocationValue } from './LocationPicker';
import { useAllowsWatchers } from './watchers';

/**
 * What may already have been reported, shown while it is still free to act on.
 *
 * The brief names duplicate tickets as one of the things this system exists to
 * reduce, and the questionnaire's order is what makes that possible: it asks
 * for a subcategory and a location **before** it asks for a title. By the time
 * somebody has chosen "Printer/Scanner" and "Level 3" the query can already be
 * answered, and they have typed nothing they would have to abandon. Ten
 * seconds later, after two paragraphs of description, the same panel is an
 * insult. The timing is the feature.
 *
 * **It never blocks a report.** No disabled button, no confirmation step,
 * nothing hidden. A false positive that stops a real report is far worse than
 * the duplicate it prevented — the reporter is the only one who knows whether
 * the printer on their floor is the printer in that ticket. Everything here is
 * advisory, and the sentence under the heading says so in as many words.
 *
 * ## Two lists, two different claims
 *
 * `live` asks *is this already reported?* and `resolved` says *this was fixed
 * before, here is what worked* — the second is self-service and its whole
 * value is `resolution_summary`, so the card shows the summary and not merely
 * the title. They are separate headings rather than one ranked list because
 * they call for different actions.
 *
 * Inside each list the API has already ranked by specificity and then by
 * recency, and `match` says which band a card is in. "Someone reported this
 * exact desk an hour ago" and "something of this kind happened in this
 * building last week" are different statements, and merged into one flat list
 * the strong one is worth no more than the weak one. `MatchChip` leads every
 * card so that a column of them reads as the grouping the ranking already is.
 *
 * ## Why the query runs before the panel is visible
 *
 * The request needs a subcategory and a building; the panel is *shown* once
 * the whole location is complete, which for a FLOOR or SEAT group is a floor
 * and possibly a desk later. Asking at the earlier moment means the answer is
 * usually already in hand when the panel is allowed to appear, so there is
 * nothing to show a spinner for and nothing arrives late enough to shove the
 * title field down the page while somebody is reading it. When both lists come
 * back empty — the common case — nothing is rendered at all.
 *
 * **This panel does not scroll the phone to itself**, although every numbered
 * question does (`ReportSection`, and D56 for why that runs from `onEntered`).
 * It opens in the same commit as question 4, whose own `onEntered` scrolls, and
 * two handlers competing for one scroll position resolve in whatever order
 * React happens to flush them. One of them owning it is worth more than both
 * of them trying.
 */
/**
 * Ids tying each group's region to its own heading.
 *
 * Constants rather than `useId`, because there is exactly one of this panel on
 * the page — it lives inside one questionnaire — and a stable id is one less
 * thing between a reader of the markup and what it means.
 */
const LIVE_HEADING_ID = 'suggestions-live-heading';
const RESOLVED_HEADING_ID = 'suggestions-resolved-heading';

export interface SuggestionPanelProps {
  /** The chosen subcategory, or `null` while the reporter is still choosing. */
  categoryId: string | null;
  /** Where the problem is, as far as the questionnaire knows so far. */
  location: LocationValue;
  /** The group's name, which decides whether a seat is a desk or a room. */
  groupName?: string | null;
  /** Whether the reporter has answered enough to be shown this. */
  revealed: boolean;
}

export function SuggestionPanel({
  categoryId,
  location,
  groupName,
  revealed,
}: SuggestionPanelProps) {
  const query = suggestionQuery(categoryId, location);
  const suggestions = useIncidentSuggestions(query);
  const allowsWatchers = useAllowsWatchers(categoryId);

  const live = suggestions.data?.live ?? [];
  const resolved = suggestions.data?.resolved ?? [];
  const seatNoun = seatFieldLabel(groupName).toLowerCase();

  /*
   * A failed request is deliberately silent. This panel is an extra the
   * reporter did not ask for, and "we could not check for duplicates" is a
   * sentence that worries somebody who was about to fill in a form and gives
   * them nothing to do about it. The report itself is unaffected.
   */
  return (
    <Collapse in={revealed && live.length + resolved.length > 0} unmountOnExit>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 5, bgcolor: 'action.hover' }}>
        <Typography variant="h3" component="h2">
          Before you carry on
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
          Tickets of this kind, from where you said the problem is. If none of them is yours,
          carry straight on — nothing here stops you reporting.
        </Typography>

        {/*
          Each group is a named region, and that name is its own heading. Two
          lists of ticket cards sitting one above the other are told apart by a
          sighted reader from the heading above them and by everyone else from
          nothing at all, unless the grouping is in the markup as well as in
          the layout. `aria-labelledby` rather than `aria-label` so there is
          one copy of the wording.
        */}
        {live.length > 0 ? (
          <Box
            component="section"
            aria-labelledby={LIVE_HEADING_ID}
            sx={{ mb: resolved.length > 0 ? 3 : 0 }}
          >
            <Typography variant="subtitle2" component="h3" id={LIVE_HEADING_ID}>
              Still open — is this already reported?
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {allowsWatchers
                ? "If one of these is your problem, say you're affected instead of reporting it again."
                : 'If one of these is your problem, there is nothing more for you to do.'}
            </Typography>
            <Box sx={{ display: 'grid', gap: 1.5, mt: 1.5 }}>
              {live.map((suggestion) => (
                <LiveSuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  seatNoun={seatNoun}
                  allowsWatchers={allowsWatchers}
                />
              ))}
            </Box>
          </Box>
        ) : null}

        {resolved.length > 0 ? (
          <Box component="section" aria-labelledby={RESOLVED_HEADING_ID}>
            <Typography variant="subtitle2" component="h3" id={RESOLVED_HEADING_ID}>
              Fixed before — here is what worked
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              The same kind of problem in the same place, and the note the engineer left.
            </Typography>
            <Box sx={{ display: 'grid', gap: 1.5, mt: 1.5 }}>
              {resolved.map((suggestion) => (
                <ResolvedSuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  seatNoun={seatNoun}
                />
              ))}
            </Box>
          </Box>
        ) : null}
      </Paper>
    </Collapse>
  );
}

/**
 * The question to ask, or `null` when there is not yet one to ask.
 *
 * A subcategory and a building are what the endpoint requires; the floor and
 * the desk only sharpen the ranking, and a group that never asks for them must
 * still get suggestions.
 */
function suggestionQuery(
  categoryId: string | null,
  location: LocationValue,
): IncidentSuggestionQuery | null {
  if (!categoryId || !location.building_id) {
    return null;
  }
  return {
    category_id: categoryId,
    building_id: location.building_id,
    floor_id: location.floor_id,
    seat_id: location.seat_id,
  };
}

/** One open ticket that may be the same problem. */
function LiveSuggestionCard({
  suggestion,
  seatNoun,
  allowsWatchers,
}: {
  suggestion: LiveSuggestion;
  seatNoun: string;
  allowsWatchers: boolean;
}) {
  return (
    // An `<article>` named by its reference: each card is one self-contained
    // item about one ticket, and naming it is what lets a screen reader move
    // between them instead of hearing one run of text with chips in it.
    <Card component="article" aria-label={suggestion.reference}>
      <CardContent
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ minWidth: 0, flex: '1 1 260px' }}>
          <SuggestionHeader
            match={suggestion.match}
            seatNoun={seatNoun}
            id={suggestion.id}
            reference={suggestion.reference}
            when={`reported ${relativeTime(suggestion.created_at)}`}
          />
          <TicketTitle density="card">{suggestion.title}</TicketTitle>
          <Box
            sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}
          >
            <StatusChip status={suggestion.status} />
            <PriorityChip priority={suggestion.priority} />
            <Typography variant="caption" color="text.secondary">
              {suggestion.location.path}
            </Typography>
          </Box>
        </Box>

        {allowsWatchers ? (
          <RowActions>
            <AffectedTooButton id={suggestion.id} reference={suggestion.reference} />
          </RowActions>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** One ticket already fixed, led by the note that fixed it. */
function ResolvedSuggestionCard({
  suggestion,
  seatNoun,
}: {
  suggestion: ResolvedSuggestion;
  seatNoun: string;
}) {
  return (
    <Card component="article" aria-label={suggestion.reference}>
      <CardContent>
        <SuggestionHeader
          match={suggestion.match}
          seatNoun={seatNoun}
          id={suggestion.id}
          reference={suggestion.reference}
          when={`fixed ${relativeTime(suggestion.resolved_at)}`}
        />
        <TicketTitle density="card">{suggestion.title}</TicketTitle>

        {/* Quoted rather than run on as another line of the card: this is
            somebody else's words and it is the reason the card is here, so it
            should not read as metadata about the ticket. */}
        <Box sx={{ mt: 1, pl: 1.5, borderLeft: '3px solid', borderColor: 'success.main' }}>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {suggestion.resolution_summary}
          </Typography>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {suggestion.location.path}
        </Typography>
      </CardContent>
    </Card>
  );
}

/** The line both cards lead with: how close, which ticket, how long ago. */
function SuggestionHeader({
  match,
  seatNoun,
  id,
  reference,
  when,
}: {
  match: SuggestionMatch;
  seatNoun: string;
  id: string;
  reference: string;
  when: string;
}) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 0.5 }}>
      <MatchChip match={match} seatNoun={seatNoun} />
      <SuggestionLink id={id} reference={reference} />
      <Typography variant="caption" color="text.secondary">
        {when}
      </Typography>
    </Box>
  );
}

/**
 * How close this ticket is to where the reporter said their problem is.
 *
 * Worded against *their* answer — "Same desk", not "Desk" — because the claim
 * is a relationship between two locations and not a property of one. That is
 * also why the wording lives here rather than in `display/labels.ts` with the
 * domain enums: it is only meaningful beside the form that produced the other
 * half of the comparison.
 *
 * **Filled for a seat, outlined for the rest**, following `PriorityChip`'s
 * reasoning: the card a reader most needs to notice is the only one carrying a
 * solid block of colour, which is a difference in form rather than in hue and
 * survives a colour-vision deficiency and a black-and-white printout. The word
 * distinguishes a floor from a building on its own.
 */
function MatchChip({ match, seatNoun }: { match: SuggestionMatch; seatNoun: string }) {
  const labels: Record<SuggestionMatch, string> = {
    SEAT: `Same ${seatNoun}`,
    FLOOR: 'Same floor',
    BUILDING: 'Same building',
  };

  return (
    <Chip
      size="small"
      icon={<PlaceOutlinedIcon />}
      label={labels[match]}
      color={match === 'BUILDING' ? 'default' : 'warning'}
      variant={match === 'SEAT' ? 'filled' : 'outlined'}
    />
  );
}

/**
 * The ticket reference, as a link that opens in a new tab.
 *
 * **The one place in this application where a ticket link does that**, and the
 * form is the reason. Following it in place unmounts `ReportPage`, and with it
 * the five `useState` answers the reporter has given — the browser's back
 * button restores the route and not the form, so a reader who clicks a
 * suggestion to check whether it is really their problem loses everything they
 * had chosen. A new tab leaves the half-filled form untouched behind it, which
 * is the only outcome that makes checking a suggestion free. The icon and the
 * accessible name both say it opens a new tab, so it is not a surprise.
 *
 * It is the *reference* that is the link, per `TicketTitle`'s rule: a title is
 * always ink and what is clickable is the reference. Deliberately not the
 * whole-card `stretchedLink` the home screens use either — an accidental card
 * click there costs a reader nothing, and here it would cost them a new tab
 * they did not ask for on top of a card that carries its own button.
 */
function SuggestionLink({ id, reference }: { id: string; reference: string }) {
  return (
    <Link
      component={RouterLink}
      to={incidentPath(id)}
      target="_blank"
      rel="noopener"
      aria-label={`${reference} — opens in a new tab`}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }}
    >
      {reference}
      <OpenInNewIcon sx={{ fontSize: 14 }} />
    </Link>
  );
}

/**
 * "I'm affected too", on one open ticket.
 *
 * **One-way here, reversible on the ticket page.** `IncidentListItem` — which
 * is what a live suggestion is — carries no `is_watching`, so this button
 * cannot know whether the reporter is *already* subscribed and must not claim
 * to: a toggle reading "I'm affected too" on a ticket they are already
 * following would be a lie about the state it was drawing. Pressing it says
 * one thing the API will honour either way, and what comes back is the state
 * this card then shows. Undoing it lives on the ticket itself, where
 * `is_watching` is a fact rather than a guess, and the confirmation says so.
 */
function AffectedTooButton({ id, reference }: { id: string; reference: string }) {
  const { notify } = useSnackbar();
  const setWatching = useSetWatching();
  const [watched, setWatched] = useState<WatchState | null>(null);

  if (watched) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, color: 'success.main' }}>
        <CheckCircleOutlinedIcon fontSize="small" />
        <Typography variant="body2">
          We&apos;ll keep you posted. {affectedCount(watched.watcher_count)}.
        </Typography>
      </Box>
    );
  }

  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<GroupAddOutlinedIcon />}
      loading={setWatching.isPending}
      onClick={() =>
        setWatching.mutate(
          { id, watching: true },
          {
            onSuccess: (result) => setWatched(result),
            // Not an `Alert` in the card: a failure to subscribe is not a
            // failure of the thing the reporter came here to do, and this
            // panel must never look like something standing in their way.
            onError: () =>
              notify(
                `Could not add you to ${reference}. You can still report the issue.`,
                'error',
              ),
          },
        )
      }
    >
      I&apos;m affected too
    </Button>
  );
}

/** "3 people are affected", agreeing with itself at one. */
function affectedCount(count: number): string {
  return count === 1 ? '1 person is affected' : `${count} people are affected`;
}
