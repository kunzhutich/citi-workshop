import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorageIcon from '@mui/icons-material/Storage';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { HealthReport } from '../../api/health';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useHealth } from './useHealth';

/**
 * Walking-skeleton status page.
 *
 * It exists to prove one thing end to end: the browser reaches the API at
 * `/api/v1/health` through the same relative path locally (Vite dev proxy) and
 * in the cloud (CloudFront), and the API in turn reaches PostgreSQL. Later
 * phases replace it with the real persona home pages.
 */
export function StatusPage() {
  const { isMobile } = useBreakpoint();
  const { data, error, isPending, isFetching, refetch } = useHealth();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h1" gutterBottom>
            ACME Facility Incident Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Report workplace and facility issues, track them to resolution.
          </Typography>
        </Box>

        <Card variant="outlined">
          <CardContent>
            <Stack
              direction={isMobile ? 'column' : 'row'}
              spacing={2}
              sx={{
                alignItems: isMobile ? 'flex-start' : 'center',
                justifyContent: 'space-between',
              }}
            >
              <Typography variant="h2">System status</Typography>
              <Button
                startIcon={<RefreshIcon />}
                onClick={() => void refetch()}
                disabled={isFetching}
                size="small"
                fullWidth={isMobile}
              >
                {isFetching ? 'Checking…' : 'Check again'}
              </Button>
            </Stack>

            <Divider sx={{ my: 2 }} />

            {isPending ? <PendingState /> : null}
            {error ? <UnreachableState message={error.message} /> : null}
            {data ? <HealthDetails report={data} stacked={isMobile} /> : null}
          </CardContent>
        </Card>

        <Typography variant="caption" color="text.secondary">
          Viewport: {isMobile ? 'mobile' : 'desktop'} layout
        </Typography>
      </Stack>
    </Container>
  );
}

function PendingState() {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <CircularProgress size={20} />
      <Typography variant="body2">Contacting the API…</Typography>
    </Stack>
  );
}

function UnreachableState({ message }: { message: string }) {
  return (
    <Alert severity="error" icon={<CancelIcon />}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        The API could not be reached.
      </Typography>
      <Typography variant="body2">{message}</Typography>
    </Alert>
  );
}

function HealthDetails({ report, stacked }: { report: HealthReport; stacked: boolean }) {
  const healthy = report.status === 'ok';
  return (
    <Stack spacing={2}>
      <Stack
        direction={stacked ? 'column' : 'row'}
        spacing={1}
        sx={{ alignItems: 'flex-start' }}
      >
        <Chip
          icon={healthy ? <CheckCircleIcon /> : <CancelIcon />}
          color={healthy ? 'success' : 'warning'}
          label={healthy ? 'API healthy' : 'API degraded'}
        />
        <Chip
          icon={<StorageIcon />}
          color={report.database.status === 'ok' ? 'success' : 'error'}
          variant="outlined"
          label={`Database ${report.database.status}`}
        />
        <Chip variant="outlined" label={`Environment: ${report.environment}`} />
        <Chip variant="outlined" label={`API v${report.api_version}`} />
      </Stack>

      {report.database.version ? (
        <Typography variant="body2" color="text.secondary">
          {report.database.version}
        </Typography>
      ) : null}

      {report.database.detail ? (
        <Alert severity="warning">Database probe failed: {report.database.detail}</Alert>
      ) : null}

      <Typography variant="caption" color="text.secondary">
        Checked at {new Date(report.checked_at).toLocaleString()}
      </Typography>
    </Stack>
  );
}
