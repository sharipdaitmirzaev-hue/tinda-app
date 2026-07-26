import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import {
  has_role,
  is_staff,
  type AuthUserPayload,
} from "@/lib/access";

const CLIENT_TYPE_LABELS: Record<string, string> = {
  shop: "Магазин",
  cafe: "Кафе",
  restaurant: "Ресторан",
  hotel: "Гостиница",
  wholesaler: "Оптовик",
  banquet_hall: "Банкетный зал",
  other: "Другое",
};

export function client_type_label(client_type: string | null): string | null {
  if (!client_type) return null;
  return CLIENT_TYPE_LABELS[client_type] ?? client_type;
}

export function assert_staff(payload: AuthUserPayload): void {
  if (!is_staff(payload.user.roles)) {
    throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
  }
}

function map_request_list_item(client: {
  id: string;
  company_name: string;
  inn: string;
  client_type: string | null;
  contact_name: string;
  phone: string;
  email: string;
  status: string;
  created_at: Date;
  city: { id: string; name: string };
  manager: { id: string; full_name: string; email: string } | null;
}) {
  return {
    id: client.id,
    company_name: client.company_name,
    inn: client.inn,
    city: {
      id: client.city.id,
      name: client.city.name,
    },
    client_type: client.client_type,
    client_type_label: client_type_label(client.client_type),
    contact_name: client.contact_name,
    phone: client.phone,
    email: client.email,
    created_at: client.created_at.toISOString(),
    status: client.status,
    manager: client.manager
      ? {
          id: client.manager.id,
          full_name: client.manager.full_name,
          email: client.manager.email,
        }
      : null,
  };
}

function map_request_detail(client: {
  id: string;
  company_name: string;
  inn: string;
  kpp: string | null;
  legal_name: string | null;
  legal_address: string | null;
  client_type: string | null;
  contact_name: string;
  phone: string;
  extra_phone: string | null;
  email: string;
  address: string;
  comment: string | null;
  status: string;
  rejected_reason: string | null;
  approved_at: Date | null;
  created_at: Date;
  city: { id: string; name: string; region: string };
  manager: { id: string; full_name: string; email: string } | null;
}) {
  return {
    id: client.id,
    company_name: client.company_name,
    inn: client.inn,
    kpp: client.kpp,
    legal_name: client.legal_name,
    legal_address: client.legal_address,
    city: {
      id: client.city.id,
      name: client.city.name,
      region: client.city.region,
    },
    client_type: client.client_type,
    client_type_label: client_type_label(client.client_type),
    contact_name: client.contact_name,
    phone: client.phone,
    extra_phone: client.extra_phone,
    email: client.email,
    address: client.address,
    comment: client.comment,
    created_at: client.created_at.toISOString(),
    status: client.status,
    rejected_reason: client.rejected_reason,
    approved_at: client.approved_at?.toISOString() ?? null,
    manager: client.manager
      ? {
          id: client.manager.id,
          full_name: client.manager.full_name,
          email: client.manager.email,
        }
      : null,
  };
}

export async function list_registration_requests(
  payload: AuthUserPayload,
  params: {
    status: "pending" | "rejected";
    city_id?: string;
    q?: string;
    page: number;
    page_size: number;
  },
) {
  assert_staff(payload);

  const where: Prisma.clientsWhereInput = {
    status: params.status,
  };

  if (params.city_id) {
    where.city_id = params.city_id;
  }

  if (params.q && params.q.trim()) {
    const q = params.q.trim();
    where.OR = [
      { company_name: { contains: q, mode: "insensitive" } },
      { inn: { contains: q } },
      { phone: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const skip = (params.page - 1) * params.page_size;

  const [total, items] = await Promise.all([
    prisma.clients.count({ where }),
    prisma.clients.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: params.page_size,
      include: {
        city: { select: { id: true, name: true } },
        manager: { select: { id: true, full_name: true, email: true } },
      },
    }),
  ]);

  return {
    items: items.map(map_request_list_item),
    page: params.page,
    page_size: params.page_size,
    total,
  };
}

export async function get_registration_request(
  payload: AuthUserPayload,
  client_id: string,
) {
  assert_staff(payload);

  const client = await prisma.clients.findUnique({
    where: { id: client_id },
    include: {
      city: { select: { id: true, name: true, region: true } },
      manager: { select: { id: true, full_name: true, email: true } },
    },
  });

  if (!client) {
    throw new AppError(404, "not_found", "Заявка не найдена");
  }

  if (client.status !== "pending" && client.status !== "rejected") {
    throw new AppError(
      404,
      "not_found",
      "Заявка не найдена в списке регистраций",
    );
  }

  const managers = has_role(payload.user.roles, "director")
    ? await list_active_managers()
    : [];

  return {
    request: map_request_detail(client),
    managers,
    can_assign_manager: has_role(payload.user.roles, "director"),
  };
}

export async function list_active_managers() {
  const managers = await prisma.users.findMany({
    where: {
      is_active: true,
      user_roles: {
        some: { role: { code: "manager" } },
      },
    },
    orderBy: { full_name: "asc" },
    select: {
      id: true,
      full_name: true,
      email: true,
    },
  });
  return managers;
}

async function assert_pending_request(client_id: string) {
  const client = await prisma.clients.findUnique({
    where: { id: client_id },
  });

  if (!client) {
    throw new AppError(404, "not_found", "Заявка не найдена");
  }

  if (client.status !== "pending") {
    throw new AppError(409, "conflict", "Заявка уже обработана");
  }

  return client;
}

async function resolve_manager_id_for_approve(
  payload: AuthUserPayload,
  requested_manager_id: string | null | undefined,
): Promise<string | null> {
  if (has_role(payload.user.roles, "manager") && !has_role(payload.user.roles, "director")) {
    // Manager always assigns self; ignore request body manager_id
    return payload.user.id;
  }

  // Director path
  if (requested_manager_id === undefined) {
    // omit → null allowed (no manager)
    return null;
  }

  if (requested_manager_id === null) {
    return null;
  }

  const manager = await prisma.users.findUnique({
    where: { id: requested_manager_id },
    include: {
      user_roles: { include: { role: true } },
    },
  });

  if (!manager || !manager.is_active) {
    throw new AppError(
      400,
      "validation_error",
      "Выбранный менеджер не найден или неактивен",
    );
  }

  const is_manager = manager.user_roles.some((item) => item.role.code === "manager");
  if (!is_manager) {
    throw new AppError(
      400,
      "validation_error",
      "Выбранный пользователь не является менеджером",
    );
  }

  return manager.id;
}

export async function approve_registration_request(
  payload: AuthUserPayload,
  client_id: string,
  body: { manager_id?: string | null },
) {
  assert_staff(payload);
  await assert_pending_request(client_id);

  const manager_id = await resolve_manager_id_for_approve(
    payload,
    body.manager_id,
  );

  const updated = await prisma.clients.update({
    where: { id: client_id },
    data: {
      status: "approved",
      manager_id,
      approved_at: new Date(),
      rejected_reason: null,
    },
    include: {
      city: { select: { id: true, name: true, region: true } },
      manager: { select: { id: true, full_name: true, email: true } },
    },
  });

  return {
    message: "Клиент подтверждён",
    request: map_request_detail(updated),
  };
}

export async function reject_registration_request(
  payload: AuthUserPayload,
  client_id: string,
  reason: string,
) {
  assert_staff(payload);
  await assert_pending_request(client_id);

  const trimmed = reason.trim();
  if (!trimmed) {
    throw new AppError(400, "validation_error", "Укажите причину отклонения");
  }

  const updated = await prisma.clients.update({
    where: { id: client_id },
    data: {
      status: "rejected",
      rejected_reason: trimmed,
    },
    include: {
      city: { select: { id: true, name: true, region: true } },
      manager: { select: { id: true, full_name: true, email: true } },
    },
  });

  return {
    message: "Заявка отклонена",
    request: map_request_detail(updated),
  };
}
