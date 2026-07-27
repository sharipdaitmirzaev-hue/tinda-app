import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import {
  assert_approved_client,
  can_view_all_clients,
  is_director,
  is_staff,
  type AuthUserPayload,
} from "@/lib/access";

const OPEN_STATUSES = ["new", "contacted"] as const;

function require_staff(payload: AuthUserPayload) {
  if (!is_staff(payload.user.roles)) {
    throw new AppError(403, "forbidden", "Доступ только для сотрудников");
  }
}

function interest_visibility_where(
  payload: AuthUserPayload,
): Prisma.product_interest_requestsWhereInput {
  if (is_director(payload) || can_view_all_clients(payload)) {
    return {};
  }
  // Manager: own clients OR assigned to them
  return {
    OR: [
      { client: { manager_id: payload.user.id } },
      { assigned_manager_id: payload.user.id },
    ],
  };
}

export async function create_or_refresh_interest_request(
  payload: AuthUserPayload,
  product_id: string,
  input: {
    request_type: "interest" | "price_request";
    requested_qty?: number | null;
    comment?: string | null;
  },
) {
  const client_id = assert_approved_client(payload);

  const product = await prisma.products.findFirst({
    where: { id: product_id, is_active: true, category: { is_active: true } },
    select: { id: true, sales_status: true, availability: true },
  });
  if (!product) {
    throw new AppError(404, "not_found", "Товар не найден");
  }

  const existing = await prisma.product_interest_requests.findFirst({
    where: {
      client_id,
      product_id,
      request_type: input.request_type,
      status: { in: [...OPEN_STATUSES] },
    },
  });

  if (existing) {
    const updated = await prisma.product_interest_requests.update({
      where: { id: existing.id },
      data: {
        requested_qty:
          input.requested_qty !== undefined
            ? input.requested_qty
            : existing.requested_qty,
        comment:
          input.comment !== undefined ? input.comment : existing.comment,
        updated_at: new Date(),
      },
    });
    return {
      request: { id: updated.id, status: updated.status },
      already_registered: true,
      message: "Ваш запрос по этому товару уже зарегистрирован",
    };
  }

  const created = await prisma.product_interest_requests.create({
    data: {
      product_id,
      client_id,
      request_type: input.request_type,
      requested_qty: input.requested_qty ?? null,
      comment: input.comment ?? null,
      status: "new",
    },
  });

  return {
    request: { id: created.id, status: created.status },
    already_registered: false,
    message: "Запрос отправлен. Менеджер свяжется с вами",
  };
}

export async function list_interest_requests(
  payload: AuthUserPayload,
  params: {
    status?: string;
    product_id?: string;
    client_id?: string;
    manager_id?: string;
    date_from?: string;
    date_to?: string;
    sort: "newest" | "most_requests" | "most_clients";
    page: number;
    page_size: number;
  },
) {
  require_staff(payload);

  const where: Prisma.product_interest_requestsWhereInput = {
    ...interest_visibility_where(payload),
  };
  if (params.status) where.status = params.status;
  if (params.product_id) where.product_id = params.product_id;
  if (params.client_id) where.client_id = params.client_id;
  if (params.manager_id) {
    where.OR = [
      ...(Array.isArray(where.OR) ? where.OR : where.OR ? [where.OR] : []),
      { assigned_manager_id: params.manager_id },
      { client: { manager_id: params.manager_id } },
    ];
  }
  if (params.date_from || params.date_to) {
    where.created_at = {};
    if (params.date_from) {
      where.created_at.gte = new Date(`${params.date_from}T00:00:00.000Z`);
    }
    if (params.date_to) {
      where.created_at.lte = new Date(`${params.date_to}T23:59:59.999Z`);
    }
  }

  const skip = (params.page - 1) * params.page_size;

  const [total, items] = await Promise.all([
    prisma.product_interest_requests.count({ where }),
    prisma.product_interest_requests.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: params.page_size,
      include: {
        product: { select: { id: true, sku: true, name: true } },
        client: {
          select: {
            id: true,
            company_name: true,
            phone: true,
            contact_name: true,
            manager_id: true,
            user: { select: { full_name: true, email: true } },
          },
        },
        assigned_manager: {
          select: { id: true, full_name: true, email: true },
        },
      },
    }),
  ]);

  // Demand analytics (scoped by same visibility)
  const analytics_where = { ...interest_visibility_where(payload) };
  const grouped = await prisma.product_interest_requests.groupBy({
    by: ["product_id"],
    where: analytics_where,
    _count: { _all: true },
    _sum: { requested_qty: true },
  });

  const product_ids = grouped.map((g) => g.product_id);
  const products = product_ids.length
    ? await prisma.products.findMany({
        where: { id: { in: product_ids } },
        select: { id: true, sku: true, name: true },
      })
    : [];
  const product_map = new Map(products.map((p) => [p.id, p]));

  const unique_clients_by_product = await prisma.product_interest_requests.findMany({
    where: analytics_where,
    select: { product_id: true, client_id: true },
    distinct: ["product_id", "client_id"],
  });
  const clients_count = new Map<string, number>();
  for (const row of unique_clients_by_product) {
    clients_count.set(
      row.product_id,
      (clients_count.get(row.product_id) || 0) + 1,
    );
  }

  let demand = grouped.map((g) => ({
    product_id: g.product_id,
    sku: product_map.get(g.product_id)?.sku ?? null,
    name: product_map.get(g.product_id)?.name ?? null,
    requests_count: g._count._all,
    unique_clients: clients_count.get(g.product_id) || 0,
    requested_qty_sum: g._sum.requested_qty ?? 0,
  }));

  if (params.sort === "most_requests") {
    demand = demand.sort((a, b) => b.requests_count - a.requests_count);
  } else if (params.sort === "most_clients") {
    demand = demand.sort((a, b) => b.unique_clients - a.unique_clients);
  } else {
    // newest — keep request list order; demand by latest activity approx requests
    demand = demand.sort((a, b) => b.requests_count - a.requests_count);
  }

  const recent = items.slice(0, 10).map(serialize_interest_row);

  return {
    items: items.map(serialize_interest_row),
    page: params.page,
    page_size: params.page_size,
    total,
    analytics: {
      top_products: demand.slice(0, 20),
      recent_requests: recent,
    },
  };
}

function serialize_interest_row(
  row: {
    id: string;
    request_type: string;
    requested_qty: number | null;
    comment: string | null;
    status: string;
    created_at: Date;
    updated_at: Date;
    product: { id: string; sku: string; name: string };
    client: {
      id: string;
      company_name: string;
      phone: string;
      contact_name: string;
      manager_id: string | null;
      user: { full_name: string; email: string };
    };
    assigned_manager: { id: string; full_name: string; email: string } | null;
  },
) {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    request_type: row.request_type,
    requested_qty: row.requested_qty,
    comment: row.comment,
    status: row.status,
    product: row.product,
    client: {
      id: row.client.id,
      company_name: row.client.company_name,
      phone: row.client.phone,
      contact_name: row.client.contact_name,
      full_name: row.client.user.full_name,
      email: row.client.user.email,
      manager_id: row.client.manager_id,
    },
    assigned_manager: row.assigned_manager,
  };
}

export async function update_interest_request_status(
  payload: AuthUserPayload,
  request_id: string,
  status: "new" | "contacted" | "closed",
  options?: { assign_self?: boolean },
) {
  require_staff(payload);

  const existing = await prisma.product_interest_requests.findFirst({
    where: {
      id: request_id,
      ...interest_visibility_where(payload),
    },
  });
  if (!existing) {
    throw new AppError(404, "not_found", "Запрос не найден");
  }

  const updated = await prisma.product_interest_requests.update({
    where: { id: request_id },
    data: {
      status,
      ...(options?.assign_self
        ? { assigned_manager_id: payload.user.id }
        : {}),
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      client: {
        select: {
          id: true,
          company_name: true,
          phone: true,
          contact_name: true,
          manager_id: true,
          user: { select: { full_name: true, email: true } },
        },
      },
      assigned_manager: {
        select: { id: true, full_name: true, email: true },
      },
    },
  });

  return { request: serialize_interest_row(updated) };
}
