import SearchIcon from '@mui/icons-material/Search';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { paths } from '../routes';

/**
 * The global ticket search in the top bar.
 *
 * It does not search. It navigates to `/tickets?q=…`, and the list screen —
 * which already owns the search box, the debounce and the results — does the
 * work. A second search implementation in the app bar would be a second place
 * for the ticket-number pattern and the full-text fallback to live.
 *
 * A form rather than a keystroke handler, so Enter submits and a phone's
 * keyboard shows a "search" key.
 */
export function TicketSearchField() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = term.trim();
    if (!trimmed) {
      return;
    }
    void navigate(`${paths.allTickets}?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form onSubmit={submit} role="search">
      <TextField
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search tickets"
        size="small"
        fullWidth={false}
        slotProps={{
          htmlInput: { 'aria-label': 'Search tickets' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: 'inherit' }} />
              </InputAdornment>
            ),
          },
        }}
        sx={(theme) => ({
          width: 260,
          // The app bar is the primary colour, so the field has to be drawn
          // against it rather than inheriting the page's form styling.
          '& .MuiOutlinedInput-root': {
            color: theme.palette.primary.contrastText,
            backgroundColor: 'rgba(255, 255, 255, 0.12)',
            '& fieldset': { borderColor: 'rgba(255, 255, 255, 0.3)' },
            '&:hover fieldset': { borderColor: 'rgba(255, 255, 255, 0.5)' },
            '&.Mui-focused fieldset': { borderColor: theme.palette.primary.contrastText },
          },
          '& .MuiOutlinedInput-input::placeholder': {
            color: theme.palette.primary.contrastText,
            opacity: 0.8,
          },
        })}
      />
    </form>
  );
}
