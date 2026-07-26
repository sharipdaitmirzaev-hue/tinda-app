import { AppError } from "@/lib/http/errors";
import {
  can_edit_catalog,
  is_staff,
  type AuthUserPayload,
} from "@/lib/access";

/** Shared catalog-edit guard for staff services and route handlers. */
export function assert_catalog_editor(payload: AuthUserPayload): void {
  if (!is_staff(payload.user.roles) || !can_edit_catalog(payload)) {
    throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
  }
}
