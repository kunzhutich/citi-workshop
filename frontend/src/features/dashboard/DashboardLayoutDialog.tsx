import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';

import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import type { DashboardLayoutControls } from './useDashboardLayout';

export interface DashboardLayoutDialogProps {
  open: boolean;
  onClose: () => void;
  controls: DashboardLayoutControls;
}

/**
 * Choosing what the dashboard shows and in what order.
 *
 * One list, grouped by the two scopes the dashboard is built around, with a
 * switch and a pair of arrows per row. The arrows stop at the boundary between
 * the groups — a "right now" figure cannot be moved under the period heading,
 * because the two mean different things and a number under the wrong one is
 * the failure the whole screen is arranged to prevent (D9, D10).
 *
 * **Arrows rather than dragging.** Dragging is what people expect and it is
 * also the gesture that needs a pointer, a library and a keyboard story that
 * usually never arrives. Two buttons are reachable by Tab, announced by a
 * screen reader, and work on a phone without a long-press. Each one names the
 * section it moves, so a screen reader hears "Move Engineer workload up"
 * rather than nine identical "Move up" buttons.
 *
 * There is no Save. Every change applies and is stored as it is made, and the
 * dialog is a view onto the arrangement rather than a form over it — which is
 * why closing it is `Done` and not `Cancel`.
 */
export function DashboardLayoutDialog({ open, onClose, controls }: DashboardLayoutDialogProps) {
  const { sections, toggle, move, reset, isCustomised } = controls;

  const groups = [
    { scope: 'period' as const, heading: 'Reported in the selected period' },
    { scope: 'current' as const, heading: 'Right now' },
  ];

  return (
    <ResponsiveDialog open={open} onClose={onClose} title="Customise this dashboard" maxWidth="sm">
      <DialogContent dividers>
        <DialogContentText sx={{ mb: 2 }}>
          Turn off what you do not use, and put what you do at the top. The headline figures
          under each heading always stay. Saved in this browser for your account.
        </DialogContentText>

        {groups.map((group) => {
          const inScope = sections.filter((section) => section.scope === group.scope);
          return (
            <Box key={group.scope} sx={{ mb: 3 }}>
              <Typography variant="overline" color="text.secondary">
                {group.heading}
              </Typography>
              <Divider sx={{ mb: 1 }} />

              {inScope.map((section, index) => (
                <Box
                  key={section.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 0.5,
                  }}
                >
                  <Switch
                    size="small"
                    checked={section.visible}
                    onChange={() => toggle(section.id)}
                    slotProps={{ input: { 'aria-label': `Show ${section.label}` } }}
                  />
                  <Typography
                    variant="body2"
                    sx={{ flexGrow: 1, color: section.visible ? 'text.primary' : 'text.secondary' }}
                  >
                    {section.label}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={`Move ${section.label} up`}
                    disabled={index === 0}
                    onClick={() => move(section.id, -1)}
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={`Move ${section.label} down`}
                    disabled={index === inScope.length - 1}
                    onClick={() => move(section.id, 1)}
                  >
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          );
        })}
      </DialogContent>

      <DialogActions>
        <Button onClick={reset} disabled={!isCustomised}>
          Reset to default
        </Button>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
