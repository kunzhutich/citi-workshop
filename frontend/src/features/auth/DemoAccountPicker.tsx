import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { DEMO_ACCOUNT_GROUPS, DEMO_PASSWORD } from './demoAccounts';

/**
 * A collapsed list of the seeded accounts, so a demonstration starts with one
 * click instead of a typed email address.
 *
 * Collapsed by default: the sign-in form is the screen's purpose and this is a
 * convenience beside it, not the main path. Opening it is one click and the
 * choice then stays open while the demonstrator moves between personas.
 *
 * Each account is a real `<button>` so it is reachable by keyboard and
 * announced as an action — the S6 accessibility pass established that a thing
 * you click has to be a control, and a `<div onClick>` here would undo it.
 * The level note on each engineer is the part worth reading aloud: a JUNIOR
 * and a LEAD see genuinely different screens, which is the point of showing
 * more than one.
 */
export function DemoAccountPicker({
  onPick,
}: {
  onPick: (email: string, password: string) => void;
}) {
  return (
    <Box>
      <Divider sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Demo accounts
        </Typography>
      </Divider>

      <Accordion
        disableGutters
        elevation={0}
        sx={{
          border: (theme) => `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          '&::before': { display: 'none' },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2">Sign in as someone</Typography>
        </AccordionSummary>

        <AccordionDetails sx={{ pt: 0 }}>
          <Stack spacing={2}>
            {DEMO_ACCOUNT_GROUPS.map((group) => (
              <Box key={group.label}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: 'block', lineHeight: 2 }}
                >
                  {group.label}
                </Typography>

                <Stack spacing={0.5}>
                  {group.accounts.map((account) => (
                    <Button
                      key={account.email}
                      onClick={() => onPick(account.email, DEMO_PASSWORD)}
                      variant="outlined"
                      size="small"
                      sx={{
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        py: 1,
                        px: 1.5,
                      }}
                    >
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {account.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {account.note}
                        </Typography>
                      </Box>
                    </Button>
                  ))}
                </Stack>
              </Box>
            ))}

            <Typography variant="caption" color="text.secondary">
              Every demo account uses the same password. Choosing one fills the form; press
              Sign in.
            </Typography>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
