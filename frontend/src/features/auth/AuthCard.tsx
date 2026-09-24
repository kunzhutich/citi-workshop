import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import acmeLogoDark from '../../assets/acme-logo-dark.png';

export interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Links shown under the card, such as "Create an account". */
  footer?: ReactNode;
}

/**
 * The frame the three signed-out screens share.
 *
 * They render outside `AppShell` — there is no navigation to offer someone who
 * is not signed in, and the forced password change deliberately offers none
 * either. One container keeps the three visually identical and sized for a
 * phone, since `maxWidth="sm"` plus the page padding is already the mobile
 * layout.
 */
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          {/*
            The dark mark, because the page behind it is the cream
            `background.default`; the app bar's light one would disappear into
            it.

            It replaces the "ACME Facilities" overline rather than joining it,
            so the name is said once. `alt` still carries that name: nothing
            else on these screens says whose application this is, the heading
            under it is "Sign in" rather than the brand, and so the mark is
            content here and not decoration.
          */}
          <Box
            component="img"
            src={acmeLogoDark}
            alt="ACME Facilities"
            sx={{ display: 'block', height: { xs: 32, md: 40 }, width: 'auto', mb: 1.5 }}
          />
          <Typography variant="h1">{title}</Typography>
          {subtitle ? (
            <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>

        <Card>
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>{children}</CardContent>
        </Card>

        {footer ? <Box>{footer}</Box> : null}
      </Stack>
    </Container>
  );
}
