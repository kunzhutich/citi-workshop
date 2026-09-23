import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { Category } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { useSnackbar } from '../../components/SnackbarContext';
import { locationDetailLabel } from '../../display/labels';
import { CategoryIcon } from '../incidents/CategoryIcon';
import { CategoryDialog } from './CategoryDialog';
import { useCategoryTree, useCreateCategory, useDeleteCategory, useUpdateCategory } from './hooks';

/** Which dialog is open, and what it is editing. */
type Editing = { category: Category | null; parentId: string | null } | null;

/**
 * The groups and subcategories the report questionnaire is built from.
 *
 * Nested rather than two flat tables, because the nesting *is* the model: a
 * subcategory has no meaning outside its group, and the questionnaire asks the
 * two questions in that order. An accordion per group mirrors what a reporter
 * sees — and it is the only layout in which "which group is this under?" never
 * has to be asked.
 *
 * Deleting is offered as "Remove", not "Delete", because the API may do either:
 * a category no incident references is deleted, and one that is referenced is
 * deactivated so the tickets filed under it keep their category. The result
 * message says which happened.
 */
export function CategoriesPage() {
  const { notify } = useSnackbar();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const tree = useCategoryTree(includeInactive);
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const remove = async (category: Category) => {
    try {
      const result = await deleteCategory.mutateAsync(category.id);
      notify(result.detail, result.deactivated ? 'warning' : 'success');
    } catch (error) {
      notify(describeError(error, 'Could not remove that category.').message, 'error');
    }
  };

  const reactivate = async (category: Category) => {
    try {
      await updateCategory.mutateAsync({ id: category.id, payload: { is_active: true } });
      notify(`${category.name} is active again.`);
    } catch (error) {
      notify(describeError(error, 'Could not reactivate that category.').message, 'error');
    }
  };

  return (
    <Box>
      <PageHeader
        title="Categories"
        description="What the report questionnaire offers, in the order it offers it."
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setEditing({ category: null, parentId: null })}
          >
            New group
          </Button>
        }
      />

      <FormControlLabel
        control={
          <Switch
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
        }
        label="Show deactivated categories"
        sx={{ mb: 2 }}
      />

      <QueryState
        isPending={tree.isPending}
        error={tree.error}
        errorFallback="Could not load the categories."
      >
        {(tree.data?.groups ?? []).map((group) => (
          <Accordion key={group.id} defaultExpanded={false} disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1, pr: 2 }}>
                <CategoryIcon iconName={group.icon} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {group.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {group.hint ?? 'No hint'} · {locationDetailLabel(group.location_detail)} ·{' '}
                    {group.children.length} subcategories
                  </Typography>
                </Box>
                {!group.is_active ? <Chip size="small" label="Deactivated" /> : null}
              </Box>
            </AccordionSummary>

            <AccordionDetails>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Button size="small" onClick={() => setEditing({ category: group, parentId: null })}>
                  Edit group
                </Button>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setEditing({ category: null, parentId: group.id })}
                >
                  Add subcategory
                </Button>
                {group.is_active ? (
                  <Button size="small" color="warning" onClick={() => void remove(group)}>
                    Remove group
                  </Button>
                ) : (
                  <Button size="small" onClick={() => void reactivate(group)}>
                    Reactivate
                  </Button>
                )}
              </Box>

              <List dense disablePadding>
                {group.children.map((child) => (
                  <ListItem
                    key={child.id}
                    disableGutters
                    secondaryAction={
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Button
                          size="small"
                          onClick={() => setEditing({ category: child, parentId: group.id })}
                        >
                          Edit
                        </Button>
                        {child.is_active ? (
                          <Button size="small" color="warning" onClick={() => void remove(child)}>
                            Remove
                          </Button>
                        ) : (
                          <Button size="small" onClick={() => void reactivate(child)}>
                            Reactivate
                          </Button>
                        )}
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={child.name}
                      secondary={`Order ${child.sort_order}${child.is_active ? '' : ' · deactivated'}`}
                    />
                  </ListItem>
                ))}
                {group.children.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No subcategories yet. Nothing can be reported under this group until there is
                    one.
                  </Typography>
                ) : null}
              </List>
            </AccordionDetails>
          </Accordion>
        ))}
      </QueryState>

      {editing ? (
        <CategoryDialog
          open
          onClose={() => setEditing(null)}
          category={editing.category}
          parentId={editing.parentId}
          isSubmitting={createCategory.isPending || updateCategory.isPending}
          onSubmit={async (payload) => {
            if (editing.category) {
              await updateCategory.mutateAsync({ id: editing.category.id, payload });
              notify('Category updated.');
            } else {
              await createCategory.mutateAsync(
                payload as Parameters<typeof createCategory.mutateAsync>[0],
              );
              notify('Category added.');
            }
          }}
        />
      ) : null}
    </Box>
  );
}
