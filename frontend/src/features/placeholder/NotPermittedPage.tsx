import BlockIcon from '@mui/icons-material/Block';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router-dom';

import { paths } from '../../routes';

/**
 * Shown when a signed-in user opens a route their role does not cover.
 *
 * An explanation, not a redirect: a URL someone pasted to you should tell you
 * why it will not open.
 */
export function NotPermittedPage() {
  return (
    <Box sx={{ maxWidth: 560 }}>
      <Alert severity="warning" icon={<BlockIcon />}>
        <AlertTitle>Not available to your account</AlertTitle>
        This page is for a different role. If you think you should have access, ask a
        facility admin.
      </Alert>
      <Button component={RouterLink} to={paths.home} sx={{ mt: 2 }}>
        Go to your home page
      </Button>
    </Box>
  );
}
