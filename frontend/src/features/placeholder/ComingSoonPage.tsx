import ConstructionIcon from '@mui/icons-material/Construction';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export interface ComingSoonPageProps {
  title: string;
  /** What this screen will do, in the user's terms. */
  description: string;
  /** Build phase that delivers it, for anyone reading the app as a demo. */
  phase: string;
}

/**
 * Stand-in for a screen a later phase delivers.
 *
 * M5 builds the shell, the session and the guards; the persona screens are M6
 * and the dashboards M7. Wiring the real navigation to honest placeholders
 * makes the shell demoable — every nav item, guard and layout switch can be
 * exercised now — without pretending the feature exists.
 */
export function ComingSoonPage({ title, description, phase }: ComingSoonPageProps) {
  return (
    <Stack spacing={2}>
      <Typography variant="h1">{title}</Typography>
      <Card variant="outlined" sx={{ maxWidth: 640 }}>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <ConstructionIcon color="action" />
            <Stack spacing={0.5}>
              <Typography variant="body1">{description}</Typography>
              <Typography variant="body2" color="text.secondary">
                Arrives in {phase}.
              </Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
