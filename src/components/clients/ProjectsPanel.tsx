"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project, ProjectMilestone, ProjectAddOn } from "@/generated/prisma/client";
import {
  createProjectAction,
  updateProjectAction,
  addMilestoneAction,
  addAddOnAction,
  markMilestonePaidAction,
  markAddOnPaidAction,
  updateMilestoneAction,
  deleteMilestoneAction,
  recordProjectPaymentAction,
} from "@/app/(app)/clients/project-actions";

type ProjectWithObligations = Project & {
  milestones: ProjectMilestone[];
  addOns: ProjectAddOn[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtAmount(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function fmtDate(d: Date | string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toDateInput(d: Date | string | null) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ProjectsPanel({
  clientId,
  projects,
}: {
  clientId: number;
  projects: ProjectWithObligations[];
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAddProject(formData: FormData) {
    const result = await createProjectAction(clientId, formData);
    if ("error" in result) {
      setAddError(result.error);
      return;
    }
    setAddError(null);
    setShowAdd(false);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900">One-Time Projects</h2>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          {showAdd ? "Close" : "+ Add Project"}
        </button>
      </div>

      {showAdd && (
        <form
          action={handleAddProject}
          className="mb-4 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
        >
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-600">Project title</label>
              <input
                name="title"
                type="text"
                required
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Base amount (₹)</label>
              <input
                name="baseAmountInRupees"
                type="number"
                min="0.01"
                step="0.01"
                required
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Default milestones</label>
              {/*
               * Server action checks: formData.get("defaultMilestones") !== "false"
               * Empty string → true (create 50/50). "false" → skip.
               */}
              <select
                name="defaultMilestones"
                defaultValue=""
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              >
                <option value="">Create 50/50 milestones</option>
                <option value="false">No default milestones</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Start date</label>
              <input
                name="startDate"
                type="date"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">End date</label>
              <input
                name="endDate"
                type="date"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-600">Description (optional)</label>
              <input
                name="description"
                type="text"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-3">
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
        {projects.length === 0 && (
          <li className="text-sm text-neutral-400">No one-time projects yet.</li>
        )}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Project row
// ---------------------------------------------------------------------------

function ProjectRow({ project }: { project: ProjectWithObligations }) {
  const router = useRouter();
  const [showUpdate, setShowUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showAddMilestone, setShowAddMilestone] = useState(false);
  const [addMilestoneError, setAddMilestoneError] = useState<string | null>(null);
  const [showAddAddon, setShowAddAddon] = useState(false);
  const [addAddonError, setAddAddonError] = useState<string | null>(null);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [recordPaymentError, setRecordPaymentError] = useState<string | null>(null);

  const addOnTotal = project.addOns.reduce((s, a) => s + a.amountInPaise, 0);
  const totalAmount = project.baseAmountInPaise + addOnTotal;
  const paidAmount =
    project.milestones
      .filter((m) => m.status === "PAID")
      .reduce((s, m) => s + m.amountInPaise, 0) +
    project.addOns
      .filter((a) => a.status === "PAID")
      .reduce((s, a) => s + a.amountInPaise, 0);
  const remaining = totalAmount - paidAmount;
  const isCancelled = project.status === "CANCELLED";

  async function handleUpdate(formData: FormData) {
    const result = await updateProjectAction(project.id, formData);
    if ("error" in result) {
      setUpdateError(result.error);
      return;
    }
    setUpdateError(null);
    setShowUpdate(false);
    router.refresh();
  }

  async function handleAddMilestone(formData: FormData) {
    const result = await addMilestoneAction(project.id, formData);
    if ("error" in result) {
      setAddMilestoneError(result.error);
      return;
    }
    setAddMilestoneError(null);
    setShowAddMilestone(false);
    router.refresh();
  }

  async function handleAddAddon(formData: FormData) {
    const result = await addAddOnAction(project.id, formData);
    if ("error" in result) {
      setAddAddonError(result.error);
      return;
    }
    setAddAddonError(null);
    setShowAddAddon(false);
    router.refresh();
  }

  async function handleRecordPayment(formData: FormData) {
    const result = await recordProjectPaymentAction(project.id, formData);
    if ("error" in result) {
      setRecordPaymentError(result.error);
      return;
    }
    setRecordPaymentError(null);
    setShowRecordPayment(false);
    router.refresh();
  }

  return (
    <li className="rounded-lg border border-neutral-100 p-3 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900">{project.title}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowUpdate((v) => !v)}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            {showUpdate ? "Close" : "Update"}
          </button>
          <ProjectStatusBadge status={project.status} />
        </div>
      </div>

      {/* Amounts */}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-neutral-600">
        <span>Base {fmtAmount(project.baseAmountInPaise)}</span>
        {addOnTotal > 0 && <span>· Total {fmtAmount(totalAmount)}</span>}
        <span>· Paid {fmtAmount(paidAmount)}</span>
        {remaining > 0 ? (
          <span>· Remaining {fmtAmount(remaining)}</span>
        ) : paidAmount > 0 ? (
          <span className="text-emerald-600">· Fully paid</span>
        ) : null}
      </div>

      {/* Dates */}
      {(project.startDate || project.endDate) && (
        <div className="mt-1 text-xs text-neutral-500">
          {project.startDate && <>Started {fmtDate(project.startDate)}</>}
          {project.startDate && project.endDate && " · "}
          {project.endDate && <>Ends {fmtDate(project.endDate)}</>}
        </div>
      )}

      {/* Next action */}
      {(project.nextActionNote || project.nextActionDate) && (
        <div className="mt-1 text-xs text-neutral-400">
          → {project.nextActionNote}
          {project.nextActionDate && ` (${fmtDate(project.nextActionDate)})`}
        </div>
      )}

      {/* Update form */}
      {showUpdate && (
        <form
          action={handleUpdate}
          className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
        >
          {updateError && <p className="text-xs text-red-600">{updateError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Status</label>
              <select
                name="status"
                defaultValue={project.status}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              >
                <option value="NOT_STARTED">Not Started</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="ON_HOLD">On Hold</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Next action date</label>
              <input
                name="nextActionDate"
                type="date"
                defaultValue={toDateInput(project.nextActionDate)}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-600">Next action note</label>
              <input
                name="nextActionNote"
                type="text"
                defaultValue={project.nextActionNote ?? ""}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowUpdate(false)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Milestones */}
      {project.milestones.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Milestones
          </p>
          <ul className="space-y-1.5">
            {project.milestones.map((m) => (
              <MilestoneRow key={m.id} milestone={m} />
            ))}
          </ul>
        </div>
      )}

      {/* Add-ons */}
      {project.addOns.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Add-ons
          </p>
          <ul className="space-y-1.5">
            {project.addOns.map((a) => (
              <AddOnRow key={a.id} addOn={a} />
            ))}
          </ul>
        </div>
      )}

      {/* Add buttons — hidden for cancelled projects */}
      {!isCancelled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setShowRecordPayment((v) => !v);
              setShowAddMilestone(false);
              setShowAddAddon(false);
            }}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          >
            {showRecordPayment ? "Close" : "₹ Record Payment"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddMilestone((v) => !v);
              setShowAddAddon(false);
              setShowRecordPayment(false);
            }}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            {showAddMilestone ? "Close" : "+ Milestone"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddAddon((v) => !v);
              setShowAddMilestone(false);
              setShowRecordPayment(false);
            }}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            {showAddAddon ? "Close" : "+ Add-on"}
          </button>
        </div>
      )}

      {/* Record Payment form */}
      {showRecordPayment && (
        <form
          action={handleRecordPayment}
          className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
        >
          {recordPaymentError && (
            <p className="text-xs text-red-600">{recordPaymentError}</p>
          )}
          <p className="text-xs font-medium text-emerald-800">
            Balance remaining: {fmtAmount(remaining)}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-600">Label (e.g. &quot;Advance&quot;)</label>
              <input
                name="label"
                type="text"
                placeholder="Advance"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Amount received (₹)</label>
              <input
                name="amountInRupees"
                type="number"
                min="0.01"
                step="0.01"
                required
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Date received</label>
              <input
                name="paidAt"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Record
            </button>
            <button
              type="button"
              onClick={() => setShowRecordPayment(false)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Add Milestone form */}
      {showAddMilestone && (
        <form
          action={handleAddMilestone}
          className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
        >
          {addMilestoneError && (
            <p className="text-xs text-red-600">{addMilestoneError}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-600">Label</label>
              <input
                name="label"
                type="text"
                required
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Amount (₹)</label>
              <input
                name="amountInRupees"
                type="number"
                min="0.01"
                step="0.01"
                required
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Due date</label>
              <input
                name="dueDate"
                type="date"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowAddMilestone(false)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Add Add-on form */}
      {showAddAddon && (
        <form
          action={handleAddAddon}
          className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
        >
          {addAddonError && (
            <p className="text-xs text-red-600">{addAddonError}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-600">Description</label>
              <input
                name="description"
                type="text"
                required
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Amount (₹)</label>
              <input
                name="amountInRupees"
                type="number"
                min="0.01"
                step="0.01"
                required
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600">Due date</label>
              <input
                name="dueDate"
                type="date"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-neutral-600">Note (optional)</label>
              <input
                name="note"
                type="text"
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowAddAddon(false)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Milestone row
// ---------------------------------------------------------------------------

function MilestoneRow({ milestone }: { milestone: ProjectMilestone }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "edit" | "delete" | "markPaid">("idle");
  const [error, setError] = useState<string | null>(null);
  const isPaid = milestone.status === "PAID";

  function reset() {
    setMode("idle");
    setError(null);
  }

  async function handleMarkPaid(formData: FormData) {
    const result = await markMilestonePaidAction(milestone.id, formData);
    if ("error" in result) { setError(result.error); return; }
    reset();
    router.refresh();
  }

  async function handleEdit(formData: FormData) {
    const result = await updateMilestoneAction(milestone.id, formData);
    if ("error" in result) { setError(result.error); return; }
    reset();
    router.refresh();
  }

  async function handleDelete() {
    const result = await deleteMilestoneAction(milestone.id);
    if ("error" in result) { setError(result.error); return; }
    reset();
    router.refresh();
  }

  return (
    <li className="rounded border border-neutral-100 px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-neutral-700">{milestone.label}</span>
        <span className="text-neutral-600">{fmtAmount(milestone.amountInPaise)}</span>
        {milestone.dueDate && (
          <span className="text-neutral-400">Due {fmtDate(milestone.dueDate)}</span>
        )}
        {isPaid && milestone.paidAt && (
          <span className="text-neutral-400">Paid {fmtDate(milestone.paidAt)}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <ObligationStatusBadge status={milestone.status} />
          {/* Edit always available */}
          <button
            type="button"
            onClick={() => mode === "edit" ? reset() : (setMode("edit"), setError(null))}
            className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-neutral-700 hover:bg-neutral-50"
          >
            {mode === "edit" ? "Close" : "Edit"}
          </button>
          {/* Delete only for PENDING */}
          {!isPaid && (
            <button
              type="button"
              onClick={() => mode === "delete" ? reset() : (setMode("delete"), setError(null))}
              className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-red-700 hover:bg-red-100"
            >
              Delete
            </button>
          )}
          {/* Mark Paid only for PENDING */}
          {!isPaid && (
            <button
              type="button"
              onClick={() => mode === "markPaid" ? reset() : (setMode("markPaid"), setError(null))}
              className="rounded-md bg-neutral-900 px-2 py-0.5 text-white hover:bg-neutral-800"
            >
              Mark Paid
            </button>
          )}
        </div>
      </div>

      {/* Edit form */}
      {mode === "edit" && (
        <form
          action={handleEdit}
          className="mt-2 space-y-2 rounded border border-neutral-200 bg-neutral-50 p-2"
        >
          {error && <p className="text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="mb-0.5 block text-neutral-600">Label</label>
              <input
                name="label"
                type="text"
                defaultValue={milestone.label}
                required
                className="w-full rounded border border-neutral-300 px-2 py-0.5 text-xs"
              />
            </div>
            {/* Amount only editable when PENDING */}
            {!isPaid && (
              <div>
                <label className="mb-0.5 block text-neutral-600">Amount (₹)</label>
                <input
                  name="amountInRupees"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={(milestone.amountInPaise / 100).toFixed(2)}
                  className="w-full rounded border border-neutral-300 px-2 py-0.5 text-xs"
                />
              </div>
            )}
            <div>
              <label className="mb-0.5 block text-neutral-600">Due date</label>
              <input
                name="dueDate"
                type="date"
                defaultValue={toDateInput(milestone.dueDate)}
                className="w-full rounded border border-neutral-300 px-2 py-0.5 text-xs"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800"
            >
              Save
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Delete confirm */}
      {mode === "delete" && (
        <div className="mt-2 flex items-center gap-2 rounded border border-red-200 bg-red-50 p-2">
          {error && <p className="text-red-600">{error}</p>}
          {!error && <span className="text-neutral-700">Delete &quot;{milestone.label}&quot;?</span>}
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            Confirm Delete
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Mark Paid form */}
      {mode === "markPaid" && (
        <form
          action={handleMarkPaid}
          className="mt-2 flex items-end gap-2 rounded border border-neutral-200 bg-neutral-50 p-2"
        >
          {error && <p className="w-full text-red-600">{error}</p>}
          <div>
            <label className="mb-0.5 block text-neutral-600">Date</label>
            <input
              name="paidAt"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add-on row
// ---------------------------------------------------------------------------

function AddOnRow({ addOn }: { addOn: ProjectAddOn }) {
  const router = useRouter();
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);
  const isPaid = addOn.status === "PAID";

  async function handleMarkPaid(formData: FormData) {
    const result = await markAddOnPaidAction(addOn.id, formData);
    if ("error" in result) {
      setMarkPaidError(result.error);
      return;
    }
    setMarkPaidError(null);
    setShowMarkPaid(false);
    router.refresh();
  }

  return (
    <li className="rounded border border-neutral-100 px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-neutral-700">{addOn.description}</span>
        <span className="text-neutral-600">{fmtAmount(addOn.amountInPaise)}</span>
        {addOn.dueDate && (
          <span className="text-neutral-400">Due {fmtDate(addOn.dueDate)}</span>
        )}
        {addOn.note && (
          <span className="max-w-[200px] truncate text-neutral-400" title={addOn.note}>
            {addOn.note}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <ObligationStatusBadge status={addOn.status} />
          {!isPaid && (
            <button
              type="button"
              onClick={() => setShowMarkPaid((v) => !v)}
              className="rounded-md bg-neutral-900 px-2 py-0.5 text-white hover:bg-neutral-800"
            >
              Mark Paid
            </button>
          )}
        </div>
      </div>
      {showMarkPaid && (
        <form
          action={handleMarkPaid}
          className="mt-2 flex items-end gap-2 rounded border border-neutral-200 bg-neutral-50 p-2"
        >
          {markPaidError && (
            <p className="w-full text-red-600">{markPaidError}</p>
          )}
          <div>
            <label className="mb-0.5 block text-neutral-600">Date</label>
            <input
              name="paidAt"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setShowMarkPaid(false)}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function ProjectStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    NOT_STARTED: "bg-neutral-100 text-neutral-600",
    IN_PROGRESS: "bg-blue-50 text-blue-700",
    COMPLETED: "bg-emerald-50 text-emerald-700",
    ON_HOLD: "bg-amber-50 text-amber-700",
    CANCELLED: "bg-neutral-100 text-neutral-400",
  };
  const labels: Record<string, string> = {
    NOT_STARTED: "Not Started",
    IN_PROGRESS: "In Progress",
    COMPLETED: "Completed",
    ON_HOLD: "On Hold",
    CANCELLED: "Cancelled",
  };
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs ${styles[status] ?? styles.NOT_STARTED}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function ObligationStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: "bg-amber-50 text-amber-700",
    PAID: "bg-emerald-50 text-emerald-700",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs ${styles[status] ?? ""}`}>
      {status}
    </span>
  );
}
