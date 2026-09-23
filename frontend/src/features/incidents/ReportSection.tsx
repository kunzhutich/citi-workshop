import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export interface ReportSectionProps {
  step: number;
  question: string;
  /** Shown at the trailing edge of the heading, e.g. a "Change" link. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * One numbered question in the report questionnaire.
 *
 * The number is what makes a long scrolling form read as a sequence rather
 * than a wall — BUILD-PLAN section 7 asks for a single page whose sections
 * reveal progressively, precisely so a reporter can scroll back and change an
 * earlier answer, which a multi-page wizard does not allow.
 */
export function ReportSection({ step, question, action, children }: ReportSectionProps) {
  return (
    <Box component="section" sx={{ mb: 5 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          mb: 2,
        }}
      >
        <Typography variant="h2" component="h2">
          <Box component="span" sx={{ color: 'text.disabled', mr: 1 }}>
            {step}.
          </Box>
          {question}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  );
}
