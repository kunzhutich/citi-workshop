import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import type { CategoryTree, Engineer } from '../../api/types';
import { LevelChip } from '../../components/LevelChip';
import { availabilityLabel } from '../../display/labels';
import { CapacityBar } from './CapacityBar';

export interface EngineerRosterProps {
  engineers: Engineer[];
  categories: CategoryTree | undefined;
  /** Buttons for one engineer's row. */
  renderActions?: (engineer: Engineer) => ReactNode;
}

/**
 * The engineer roster, shared by the admin's Engineers screen and a lead's
 * Team screen.
 *
 * The same five facts answer both screens' question — who is there, how senior
 * are they, what do they cover, can they take work, how much have they got —
 * so the table is one component and each screen supplies its own row actions.
 *
 * Availability is a chip rather than a word in a column because it is the one
 * value that is read at a glance: "who can I give this to" is answered by
 * scanning for green.
 */
export function EngineerRoster({ engineers, categories, renderActions }: EngineerRosterProps) {
  const groupNames = new Map((categories?.groups ?? []).map((group) => [group.id, group.name]));

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label="Engineers">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Level</TableCell>
            <TableCell>Specialties</TableCell>
            <TableCell>Availability</TableCell>
            <TableCell>Load</TableCell>
            {renderActions ? <TableCell align="right">Actions</TableCell> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {engineers.map((engineer) => (
            <TableRow key={engineer.user_id} hover>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {engineer.full_name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {engineer.email}
                </Typography>
                {!engineer.is_active ? (
                  <Chip size="small" label="Deactivated" sx={{ ml: 1 }} />
                ) : null}
              </TableCell>
              <TableCell>
                <LevelChip level={engineer.level} />
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 260 }}>
                  {engineer.specialty_group_ids.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      Anything
                    </Typography>
                  ) : (
                    engineer.specialty_group_ids.map((id) => (
                      <Chip key={id} size="small" label={groupNames.get(id) ?? 'Unknown'} />
                    ))
                  )}
                </Box>
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  color={engineer.availability === 'AVAILABLE' ? 'success' : 'default'}
                  label={availabilityLabel(engineer.availability)}
                />
              </TableCell>
              <TableCell>
                <CapacityBar
                  active={engineer.active_ticket_count}
                  max={engineer.max_active_tickets}
                />
              </TableCell>
              {renderActions ? (
                <TableCell align="right">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                    {renderActions(engineer)}
                  </Box>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
