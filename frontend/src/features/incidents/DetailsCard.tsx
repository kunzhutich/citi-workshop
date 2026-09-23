import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import type { Incident } from '../../api/types';
import { blockedReasonLabel, closeReasonLabel } from '../../display/labels';
import { formatDateTime } from '../../display/time';

export interface DetailsCardProps {
  incident: Incident;
}

/**
 * The facts about a ticket that are not its story: who, where, when.
 *
 * A definition list rather than a table, because that is what it is — a set of
 * term-and-value pairs — and `<dl>` is what a screen reader announces as one.
 */
export function DetailsCard({ incident }: DetailsCardProps) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h3" gutterBottom>
          Details
        </Typography>

        <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1.5 }}>
          <Field term="Category">
            {incident.category.group_name ? `${incident.category.group_name} › ` : ''}
            {incident.category.name}
          </Field>
          <Field term="Location">{incident.location.path}</Field>
          <Field term="Reported by">{incident.reporter.full_name}</Field>
          <Field term="Assigned to">
            {incident.assignee?.full_name ?? (
              <Typography component="span" variant="body2" color="text.secondary">
                Nobody yet
              </Typography>
            )}
          </Field>
          <Field term="Reported">{formatDateTime(incident.created_at)}</Field>
          <Field term="Last updated">{formatDateTime(incident.updated_at)}</Field>

          {incident.is_escalated && incident.escalation_reason ? (
            <Field term="Escalated">
              {incident.escalation_reason}
              {incident.escalated_by ? ` — ${incident.escalated_by.full_name}` : ''}
            </Field>
          ) : null}

          {incident.status === 'BLOCKED' && incident.blocked_reason_type ? (
            <Field term="Blocked on">
              {blockedReasonLabel(incident.blocked_reason_type)}
              {incident.blocked_reason ? ` — ${incident.blocked_reason}` : ''}
            </Field>
          ) : null}

          {incident.resolution_summary ? (
            <Field term="Resolution">{incident.resolution_summary}</Field>
          ) : null}

          {incident.close_reason ? (
            <Field term="Closed because">
              {closeReasonLabel(incident.close_reason)}
              {incident.duplicate_of_reference ? ` (${incident.duplicate_of_reference})` : ''}
            </Field>
          ) : null}
        </Box>
      </CardContent>
    </Card>
  );
}

function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <Box>
      <Typography component="dt" variant="caption" color="text.secondary">
        {term}
      </Typography>
      <Typography
        component="dd"
        variant="body2"
        sx={{ m: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
      >
        {children}
      </Typography>
    </Box>
  );
}
