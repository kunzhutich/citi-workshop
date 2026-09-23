import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export interface SelectableCardProps {
  label: string;
  /** One line under the label, when the choice needs explaining. */
  hint?: string | null;
  icon?: ReactNode;
  selected: boolean;
  onSelect: () => void;
}

/**
 * One choice in a grid of them, behaving as a radio button.
 *
 * The questionnaire asks four of its five questions with cards rather than a
 * dropdown, because a dropdown hides the options until you open it and these
 * are the options a reporter is deciding between. A card can carry an icon and
 * a hint; a `<MenuItem>` carrying two lines of explanation is a menu nobody
 * reads.
 *
 * It is a real `<button>` with `aria-pressed`, so a screen reader announces
 * the selection and a keyboard reaches it — which a styled `<div>` with an
 * `onClick` would not.
 */
export function SelectableCard({ label, hint, icon, selected, onSelect }: SelectableCardProps) {
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 0.5,
        textAlign: 'left',
        height: '100%',
        // A card with a hint needs room for two lines under the label; one
        // without a hint is just a label, and 96px of it reads as a gap.
        minHeight: hint ? 96 : 60,
        p: 2,
        // `sx` multiplies this by the theme's shape.borderRadius.
        borderRadius: 1,
        border: '2px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        backgroundColor: selected ? 'action.selected' : 'background.paper',
        transition: theme.transitions.create(['border-color', 'background-color']),
        '&:hover': { borderColor: selected ? 'primary.main' : 'text.disabled' },
      })}
    >
      {icon ? (
        <Typography component="span" sx={{ color: selected ? 'primary.main' : 'text.secondary' }}>
          {icon}
        </Typography>
      ) : null}
      <Typography variant="subtitle2" component="span" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      {hint ? (
        <Typography variant="caption" component="span" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </ButtonBase>
  );
}
