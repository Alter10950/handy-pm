import { createAdminClient } from "./supabase-admin";

// Recursively collects every file path under a prefix. drawings/packing-
// slips are flat (`{project_id}/{filename}`, one `list()` call is enough),
// but daily-photos nests `{project_id}/{date}/{crew_id}/{filename}` —
// Supabase Storage's `list()` isn't recursive, and a folder "entry" is
// only distinguishable from a file by its `id` being null.
async function listFilesRecursively(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const { data: entries, error } = await admin.storage.from(bucket).list(prefix);
  if (error) throw error;

  const paths: string[] = [];
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      paths.push(...(await listFilesRecursively(admin, bucket, path)));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

// Deletes a test project and everything under it: the `projects` row
// cascades to drawings/materials/rows/row_materials/installs/etc. at the
// database level, but Storage objects have no FK relationship to DB rows,
// so they're removed explicitly here too. Uses the service-role client so
// cleanup always succeeds regardless of the browser session's state.
export async function deleteProjectCompletely(projectId: string) {
  const admin = createAdminClient();

  for (const bucket of ["drawings", "packing-slips"] as const) {
    const { data: objects, error: listError } = await admin.storage
      .from(bucket)
      .list(projectId);
    if (listError) throw listError;
    if (objects.length > 0) {
      const paths = objects.map((object) => `${projectId}/${object.name}`);
      const { error: removeError } = await admin.storage
        .from(bucket)
        .remove(paths);
      if (removeError) throw removeError;
    }
  }

  const photoPaths = await listFilesRecursively(admin, "daily-photos", projectId);
  if (photoPaths.length > 0) {
    const { error: removeError } = await admin.storage
      .from("daily-photos")
      .remove(photoPaths);
    if (removeError) throw removeError;
  }

  const { error } = await admin.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

// Deletes an auth user created by the team-management flow during a test
// run, found by email (the UI never surfaces a raw user id to look one up
// by). `profiles` cascades via its FK to auth.users, so nothing else needs
// cleaning up here.
export async function deleteAuthUserByEmail(email: string) {
  const admin = createAdminClient();
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const match = data.users.find((user) => user.email === email);
    if (match) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(
        match.id
      );
      if (deleteError) throw deleteError;
      return;
    }
    if (data.users.length < perPage) return;
  }
}
