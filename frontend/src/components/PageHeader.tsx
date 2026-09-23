import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  /** One line under the title saying what the screen is for. */
  description?: string;
  /** Buttons for the screen as a whole, shown at the trailing edge. */
  actions?: ReactNode;
}

/**
 * The heading every screen starts with.
 *
 * Its job is consistency: one `h1` per page, in the same place, at the same
 * size, with the screen's own actions beside it. Actions wrap under the title
 * on a narrow viewport rather than squeezing it.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        mb: 3,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h1" component="h1">
          {title}
        </Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {actions ? <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box> : null}
    </Box>
  );
}
