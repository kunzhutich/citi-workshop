import SearchOffIcon from '@mui/icons-material/SearchOff';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { Link as RouterLink, useLocation } from 'react-router-dom';

import { PageHeader } from '../../components/PageHeader';
import { paths } from '../../routes';

/**
 * Shown when a signed-in user opens a URL this application does not have.
 *
 * It replaces a `<Navigate to="/" replace>` catch-all, which silently rewrote
 * the address bar and dropped the user on the dashboard with no indication
 * that anything had happened. A stale bookmark, a typo and a link from a chat
 * message all looked exactly like "you asked for the home page".
 *
 * Same reasoning as `NotPermittedPage`, which already refused to redirect: a
 * URL somebody pasted to you should tell you why it will not open. This one
 * also shows the path, because the most useful thing a person can do with a
 * dead link is see which character of it is wrong.
 *
 * **The HTTP status really is 200.** CloudFront rewrites every extension-less
 * path to `/index.html` so that deep links survive a reload, which means the
 * server cannot know this path is not a route — only the router can, and by
 * then the response has been sent. Serving a genuine 404 would need rendering
 * on the server, which this architecture deliberately does not have. What the
 * user is told is accurate; what the network log says is a consequence of SPA
 * routing. Search engines never see it: the whole application is behind a
 * login.
 */
export function NotFoundPage() {
  const location = useLocation();

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageHeader title="Page not found" />

      <Alert severity="info" icon={<SearchOffIcon />}>
        <AlertTitle>There is nothing at this address</AlertTitle>
        <Box component="span" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {location.pathname}
        </Box>{' '}
        is not a page in this application. It may be a mistyped or out-of-date link.
      </Alert>

      <Stack direction="row" spacing={1} sx={{ mt: 3, flexWrap: 'wrap', gap: 1 }}>
        <Button component={RouterLink} to={paths.home} variant="contained">
          Go to your home page
        </Button>
        <Button component={RouterLink} to={paths.allTickets}>
          Browse all tickets
        </Button>
      </Stack>
    </Box>
  );
}
