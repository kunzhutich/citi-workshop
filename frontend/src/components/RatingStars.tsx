import Box from '@mui/material/Box';
import Rating from '@mui/material/Rating';
import Typography from '@mui/material/Typography';

/**
 * A score, drawn as stars and said in words.
 *
 * **The words are not a caption — they are the value.** Five glyphs are
 * nothing a screen reader can total, and Material UI's own label for a
 * read-only rating is a bare "4 Stars", which says how many are lit rather
 * than what four means. So the stars are `aria-hidden` everywhere this is
 * used and the text beside them carries the number.
 *
 * Its own component because three screens show the same thing — an
 * engineer's page, their reviews page, and every row on it — and a score
 * rendered three slightly different ways is three chances to disagree about
 * what a 4 looks like. The stars' colour is not here: it is
 * `MuiRating.iconFilled` in `theme.ts`, so every rating in the application
 * moves together.
 *
 * `value` may be null, which is the honest answer for an engineer nobody has
 * rated. It renders a dash rather than an empty row of stars, which would
 * read as five zeroes.
 */

export interface RatingStarsProps {
  /** 1 to 5, or null when there is nothing to show. */
  value: number | null;
  /** Anything to say after the score — a count, a period. */
  caption?: string;
  size?: 'small' | 'medium' | 'large';
  /** Show "4.1" beside the stars. Off for a single review, where the stars and a date are enough. */
  showValue?: boolean;
}

export function RatingStars({
  value,
  caption,
  size = 'medium',
  showValue = true,
}: RatingStarsProps) {
  if (value === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        Not yet rated
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
      {/*
        `precision` so an average of 4.1 draws four stars and a sliver rather
        than rounding to four — the number beside it says 4.1 either way, and
        stars that disagreed with the figure printed next to them would be
        the kind of small lie that makes a reader doubt the rest.
      */}
      <Rating value={value} precision={0.1} readOnly size={size} aria-hidden />
      {showValue ? (
        <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
          {value.toFixed(1)}
        </Typography>
      ) : null}
      {caption ? (
        <Typography variant="body2" color="text.secondary" component="span">
          {caption}
        </Typography>
      ) : null}
    </Box>
  );
}
