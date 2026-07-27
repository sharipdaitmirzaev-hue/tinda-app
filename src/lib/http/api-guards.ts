import {
  assert_approved_client,
  assert_authenticated,
  assert_catalog_editor,
  assert_director,
  assert_staff,
  type AuthUserPayload,
} from "@/lib/access";
import { get_current_auth_payload } from "@/lib/auth/current-user";

export async function require_authenticated_user(): Promise<AuthUserPayload> {
  return assert_authenticated(await get_current_auth_payload());
}

export async function require_staff_api(): Promise<AuthUserPayload> {
  const payload = await require_authenticated_user();
  assert_staff(payload);
  return payload;
}

export async function require_director_api(): Promise<AuthUserPayload> {
  const payload = await require_authenticated_user();
  assert_director(payload);
  return payload;
}

export async function require_catalog_editor_api(): Promise<AuthUserPayload> {
  const payload = await require_authenticated_user();
  assert_catalog_editor(payload);
  return payload;
}

export async function require_approved_client_api(): Promise<{
  payload: AuthUserPayload;
  client_id: string;
}> {
  const payload = await require_authenticated_user();
  const client_id = assert_approved_client(payload);
  return { payload, client_id };
}
