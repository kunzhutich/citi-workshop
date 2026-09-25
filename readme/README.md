# The written record

Everything in this folder was written for this submission. It is kept apart
from [`../docs/`](../docs/), which holds the workshop scaffold's own briefs —
`full-stack.md`, `validation.md` and the other role guides — and belongs to
[citi/coding-workshop-participant](https://github.com/citi/coding-workshop-participant)
rather than to us. That separation is the whole point of the split: a reader
should be able to tell at a glance which words are ours.

Start with [the repository README](../README.md). It is the front door and
says what the application is, how to run it and how it is built. These are the
documents behind it.

## If you are grading this

| Read | For |
| --- | --- |
| [REVIEW-GUIDE.md](REVIEW-GUIDE.md) | **Start here.** The worklist for looking at what was built, in the order that makes it quickest to judge. |
| [DEMO-SCRIPT.md](DEMO-SCRIPT.md) | A five-minute walkthrough, with the accounts to sign in as and the exact clicks. |
| [BUILD-STATUS.md](BUILD-STATUS.md) | What was delivered against what was asked for, phase by phase. |
| [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md) | Every cloud-only check, each marked with what was actually observed rather than assumed. |

## If you are taking this code over

| Read | For |
| --- | --- |
| [PROJECT-GUIDE.md](PROJECT-GUIDE.md) | **The deep one.** Part I describes the system as it stands — the data model as a narrative, every business rule and the one file that owns it, one request traced through every file it touches. Part II is the build log, one section per phase, written while the reasoning was fresh. Read Part I and stop there the first time. |
| [DECISION-LOG.md](DECISION-LOG.md) | Every call made without the owner present, with the alternatives rejected and, where one was wrong, the correction. 69 entries, numbered to D72. |
| [TODO.md](TODO.md) | Work that is **decided and deliberately not done**, with what to settle before starting each item. |
| [INFRA-CHANGES.md](INFRA-CHANGES.md) | The four edits made to the scaffold's Terraform, and why each was unavoidable. |

## Written before the work, kept for the record

| | |
| --- | --- |
| [BUILD-PLAN.md](BUILD-PLAN.md) | The specification this was built against: data model, RBAC, workflow, API, UI, and the phase order. |
| [UI-REDESIGN-BRIEF.md](UI-REDESIGN-BRIEF.md) | The owner's redesign brief, which phases R1–R7 worked through. |

## A note on how these read

They are longer than documentation usually is, on purpose. The rule followed
throughout is that a document should record **why**, including the options
that were rejected and the things that turned out to be wrong — because the
finished code already says what. Where a decision was forced by the workshop
scaffold or the AWS IAM boundary rather than freely chosen, the text says so
explicitly; that distinction is invisible in the code and is the one thing a
reader cannot reconstruct.
