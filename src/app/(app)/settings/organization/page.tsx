import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/db";

export default async function OrganizationSettingsPage() {
  const admin = await requireAdmin();

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: admin.organizationId },
  });

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Organization</h1>

      <div className="max-w-lg rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">Details</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Name</dt>
            <dd className="font-medium text-neutral-900">{org.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Account email</dt>
            <dd className="text-neutral-900">{admin.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Member since</dt>
            <dd className="text-neutral-900">
              {new Date(org.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
