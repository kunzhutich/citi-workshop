import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import type { EngineerCreated, EngineerLevel } from '../../api/types';
import { describeError } from '../../api/errors';
import type { Engineer } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, QueryState } from '../../components/QueryState';
import { useSnackbar } from '../../components/SnackbarContext';
import { levelLabel } from '../../layout/roleLabels';
import { useCategoryTree } from '../categories/hooks';
import { EngineerDialog } from './EngineerDialog';
import { EngineerRoster } from './EngineerRoster';
import {
  useCreateEngineer,
  useDeactivateEngineer,
  useEngineers,
  useUpdateEngineer,
} from './hooks';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';

const LEVELS: EngineerLevel[] = ['JUNIOR', 'SENIOR', 'LEAD'];

/**
 * The admin's engineer roster: add them, edit them, deactivate them.
 *
 * Creating one hands back a temporary password that exists in that response
 * and nowhere else, so the create flow always ends in
 * `TemporaryPasswordDialog` rather than a snackbar — a confirmation that
 * disappears after five seconds is the wrong container for the only copy of a
 * credential.
 */
export function EngineersPage() {
  const { notify } = useSnackbar();
  const [level, setLevel] = useState<EngineerLevel | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<Engineer | null | undefined>(undefined);
  const [created, setCreated] = useState<EngineerCreated | null>(null);

  const engineers = useEngineers({
    level: level || undefined,
    include_inactive: includeInactive,
    page_size: 100,
  });
  const categories = useCategoryTree();
  const createEngineer = useCreateEngineer();
  const updateEngineer = useUpdateEngineer();
  const deactivateEngineer = useDeactivateEngineer();

  const deactivate = async (engineer: Engineer) => {
    try {
      const result = await deactivateEngineer.mutateAsync(engineer.user_id);
      notify(result.detail, 'warning');
    } catch (error) {
      notify(describeError(error, 'Could not deactivate that engineer.').message, 'error');
    }
  };

  return (
    <Box>
      <PageHeader
        title="Engineers"
        description="Who resolves tickets, what they cover, and how much they are carrying."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>
            Add engineer
          </Button>
        }
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 3 }}>
        <TextField
          select
          size="small"
          label="Level"
          value={level}
          onChange={(event) => setLevel(event.target.value as EngineerLevel | '')}
          // `theme.ts` makes every text field full width, which is right for
          // forms and wrong for a filter sitting next to a switch.
          fullWidth={false}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Every level</MenuItem>
          {LEVELS.map((option) => (
            <MenuItem key={option} value={option}>
              {levelLabel(option)}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Switch
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
          }
          label="Show deactivated"
        />
      </Box>

      <QueryState
        isPending={engineers.isPending}
        error={engineers.error}
        errorFallback="Could not load the engineer roster."
      >
        {(engineers.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No engineers yet"
            description="Add one, and tickets can start being assigned."
            action={
              <Button variant="contained" onClick={() => setEditing(null)}>
                Add engineer
              </Button>
            }
          />
        ) : (
          <EngineerRoster
            engineers={engineers.data?.items ?? []}
            categories={categories.data}
            renderActions={(engineer) => (
              <>
                <Button size="small" onClick={() => setEditing(engineer)}>
                  Edit
                </Button>
                {engineer.is_active ? (
                  <Button size="small" color="warning" onClick={() => void deactivate(engineer)}>
                    Deactivate
                  </Button>
                ) : null}
              </>
            )}
          />
        )}
      </QueryState>

      {editing !== undefined ? (
        <EngineerDialog
          open
          onClose={() => setEditing(undefined)}
          engineer={editing}
          isSubmitting={createEngineer.isPending || updateEngineer.isPending}
          onCreate={async (payload) => {
            const result = await createEngineer.mutateAsync(payload);
            setCreated(result);
          }}
          onUpdate={async (payload) => {
            if (!editing) {
              return;
            }
            await updateEngineer.mutateAsync({ userId: editing.user_id, payload });
            notify(`${editing.full_name} updated.`);
          }}
        />
      ) : null}

      {created ? (
        <TemporaryPasswordDialog
          open
          onClose={() => setCreated(null)}
          engineerName={created.engineer.full_name}
          email={created.engineer.email}
          temporaryPassword={created.temporary_password}
        />
      ) : null}
    </Box>
  );
}
