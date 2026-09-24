import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { describeError } from '../../api/errors';
import type { IncidentPriority, LocationDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { useSnackbar } from '../../components/SnackbarContext';
import { INCIDENT_PRIORITIES, priorityHint, priorityLabel } from '../../display/labels';
import { incidentPath } from '../../routes';
import { useCategoryTree } from '../categories/hooks';
import { useFacilityTree } from '../facilities/hooks';
import { CategoryIcon } from './CategoryIcon';
import { useCreateIncident } from './hooks';
import { LocationPicker, type LocationValue } from './LocationPicker';
import { ReportSection } from './ReportSection';
import { reportTextSchema, TITLE_MAX_LENGTH } from './reportSchema';
import { SelectableCard } from './SelectableCard';

/**
 * The guided report questionnaire — BUILD-PLAN section 7.
 *
 * One page whose five sections reveal as the previous one is answered, not a
 * multi-page wizard: a reporter who realises at "how urgent is it?" that they
 * picked the wrong category can scroll up and fix it, which a wizard makes
 * into a back-button expedition.
 *
 * **Why plain `useState` rather than react-hook-form here**, when every other
 * form in the app uses it: react-hook-form earns its place by keeping values
 * out of React state so that typing in one field does not re-render the form.
 * This form is the opposite case — four of its five answers decide what is
 * *shown* next, so every one of them has to be watched, and watching them all
 * re-renders exactly as much as `useState` would. What remains is `Controller`
 * wrappers around four card grids that are not `<input>`s. The zod schema is
 * kept for the two fields that are ordinary text.
 */
export function ReportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notify } = useSnackbar();

  const categories = useCategoryTree();
  const facilities = useFacilityTree();
  const createIncident = useCreateIncident();

  const [groupId, setGroupId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // Pre-filled from where this user last reported something. The API keeps
  // `last_*_id` current on every successful create, and returns them on
  // `/auth/me` — most people report problems from the same desk twice.
  const [location, setLocation] = useState<LocationValue>({
    building_id: user?.last_building_id ?? null,
    floor_id: user?.last_floor_id ?? null,
    seat_id: user?.last_seat_id ?? null,
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<IncidentPriority>('MEDIUM');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const tree = categories.data;
  const group = tree?.groups.find((candidate) => candidate.id === groupId);
  const locationDetail: LocationDetail = group?.location_detail ?? 'BUILDING';

  /** Choosing a different group invalidates the subcategory under it. */
  const selectGroup = (nextGroupId: string) => {
    setGroupId(nextGroupId);
    setCategoryId(null);
  };

  const locationIsComplete =
    Boolean(location.building_id) &&
    (locationDetail === 'BUILDING' || Boolean(location.floor_id)) &&
    (locationDetail !== 'SEAT' || Boolean(location.seat_id));

  const showSubcategories = Boolean(group);
  const showLocation = Boolean(categoryId);
  const showDetails = showLocation && locationIsComplete;
  const showPriority = showDetails && title.trim() !== '' && description.trim() !== '';

  const submit = async () => {
    setFormError(null);

    const parsed = reportTextSchema.safeParse({ title, description });
    if (!parsed.success || !categoryId || !location.building_id) {
      setFieldErrors(collectIssues(parsed.error?.issues));
      return;
    }
    setFieldErrors({});

    try {
      const incident = await createIncident.mutateAsync({
        title: parsed.data.title,
        description: parsed.data.description,
        category_id: categoryId,
        building_id: location.building_id,
        floor_id: location.floor_id,
        seat_id: location.seat_id,
        priority,
      });
      notify(`${incident.reference} created.`);
      navigate(incidentPath(incident.id));
    } catch (error) {
      // The API re-checks every rule this form does, plus the ones it cannot —
      // that the category is a subcategory, that the location matches the
      // group's required detail. Its field names match the inputs above.
      const described = describeError(error, 'Could not report this issue. Please try again.');
      setFieldErrors(described.fieldErrors);
      setFormError(described.message);
    }
  };

  return (
    <Box sx={{ maxWidth: 900 }}>
      <PageHeader
        title="Report an issue"
        description="Five quick questions. Everything you answer helps it reach the right engineer."
      />

      <QueryState
        isPending={categories.isPending || facilities.isPending}
        error={categories.error ?? facilities.error}
        errorFallback="Could not load the categories and locations this form needs."
      >
        {tree && facilities.data ? (
          <>
            <ReportSection step={1} question="What kind of problem is it?">
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: {
                    xs: 'repeat(2, 1fr)',
                    sm: 'repeat(3, 1fr)',
                    lg: 'repeat(5, 1fr)',
                  },
                }}
              >
                {tree.groups.map((option) => (
                  <SelectableCard
                    key={option.id}
                    label={option.name}
                    hint={option.hint}
                    icon={<CategoryIcon iconName={option.icon} />}
                    selected={option.id === groupId}
                    onSelect={() => selectGroup(option.id)}
                  />
                ))}
              </Box>
            </ReportSection>

            <ReportSection
              step={2}
              revealed={Boolean(showSubcategories && group)}
              question="Which one?"
                action={
                  <Link
                    component="button"
                    type="button"
                    onClick={() => {
                      setGroupId(null);
                      setCategoryId(null);
                    }}
                  >
                    ← Change
                  </Link>
                }
              >
                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: {
                      xs: 'repeat(2, 1fr)',
                      sm: 'repeat(3, 1fr)',
                      lg: 'repeat(4, 1fr)',
                    },
                  }}
                >
                  {/* `unmountOnExit` means these only exist while the
                      section is revealed, and it is revealed only when a group
                      is chosen — but the guard used to be the ternary that
                      narrowed the type, and `Collapse` cannot narrow anything.
                      The fallback is unreachable and keeps it honest. */}
                  {(group?.children ?? []).map((option) => (
                    <SelectableCard
                      key={option.id}
                      label={option.name}
                      selected={option.id === categoryId}
                      onSelect={() => setCategoryId(option.id)}
                    />
                  ))}
                </Box>
                {fieldErrors.category_id ? (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {fieldErrors.category_id}
                  </Alert>
                ) : null}
            </ReportSection>

            <ReportSection step={3} revealed={showLocation} question="Where?">
                <LocationPicker
                  tree={facilities.data}
                  locationDetail={locationDetail}
                  groupName={group?.name}
                  value={location}
                  onChange={setLocation}
                  fieldErrors={fieldErrors}
                />
            </ReportSection>

            <ReportSection step={4} revealed={showDetails} question="Tell us more">
                <Box sx={{ display: 'grid', gap: 2, maxWidth: 640 }}>
                  <TextField
                    label="Title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    error={Boolean(fieldErrors.title)}
                    helperText={fieldErrors.title ?? 'A short summary, as you would say it out loud.'}
                    slotProps={{ htmlInput: { maxLength: TITLE_MAX_LENGTH } }}
                    required
                  />
                  <TextField
                    label="What happened?"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    error={Boolean(fieldErrors.description)}
                    helperText={
                      fieldErrors.description ??
                      'When it started, what you have already tried, anything else that helps.'
                    }
                    multiline
                    minRows={4}
                    required
                  />
                </Box>
            </ReportSection>

            <ReportSection step={5} revealed={showPriority} question="How urgent is it?">
                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                  }}
                >
                  {INCIDENT_PRIORITIES.map((option) => (
                    <SelectableCard
                      key={option}
                      label={priorityLabel(option)}
                      hint={priorityHint(option)}
                      selected={option === priority}
                      onSelect={() => setPriority(option)}
                    />
                  ))}
                </Box>

                {formError ? (
                  <Alert severity="error" sx={{ mt: 3 }}>
                    {formError}
                  </Alert>
                ) : null}

                <Button
                  variant="contained"
                  size="large"
                  onClick={() => void submit()}
                  loading={createIncident.isPending}
                  sx={{ mt: 3 }}
                >
                  Report this issue
                </Button>
            </ReportSection>

            {!showPriority ? (
              <Typography variant="body2" color="text.secondary">
                Answer each question and the next one appears.
              </Typography>
            ) : null}
          </>
        ) : null}
      </QueryState>
    </Box>
  );
}

/** Turn zod's issue list into the `{field: message}` shape the inputs read. */
function collectIssues(issues: { path: PropertyKey[]; message: string }[] | undefined) {
  const errors: Record<string, string> = {};
  for (const issue of issues ?? []) {
    const field = issue.path[0];
    if (typeof field === 'string') {
      errors[field] ??= issue.message;
    }
  }
  return errors;
}
