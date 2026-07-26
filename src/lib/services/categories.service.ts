import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import {
  can_edit_catalog,
  is_staff,
  type AuthUserPayload,
} from "@/lib/access";

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  children: CategoryNode[];
};

function assert_catalog_editor(payload: AuthUserPayload) {
  if (!is_staff(payload.user.roles) || !can_edit_catalog(payload)) {
    throw new AppError(403, "forbidden", "Недостаточно прав для этого действия");
  }
}

function build_tree(
  rows: Array<{
    id: string;
    name: string;
    slug: string;
    parent_id: string | null;
    sort_order: number;
    is_active: boolean;
  }>,
): CategoryNode[] {
  const by_parent = new Map<string | null, CategoryNode[]>();

  for (const row of rows) {
    const node: CategoryNode = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      parent_id: row.parent_id,
      sort_order: row.sort_order,
      is_active: row.is_active,
      children: [],
    };
    const key = row.parent_id;
    const list = by_parent.get(key) ?? [];
    list.push(node);
    by_parent.set(key, list);
  }

  function attach(parent_id: string | null): CategoryNode[] {
    const nodes = by_parent.get(parent_id) ?? [];
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ru"));
    for (const node of nodes) {
      node.children = attach(node.id);
    }
    return nodes;
  }

  return attach(null);
}

export async function list_staff_categories(payload: AuthUserPayload) {
  assert_catalog_editor(payload);
  const rows = await prisma.categories.findMany({
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });
  return { items: build_tree(rows), flat: rows };
}

export async function list_catalog_categories_tree() {
  const rows = await prisma.categories.findMany({
    where: { is_active: true },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      parent_id: true,
      sort_order: true,
      is_active: true,
    },
  });

  // Keep only nodes whose entire ancestor chain is active (all fetched are active)
  return { items: build_tree(rows) };
}

async function assert_parent_valid(
  category_id: string | null,
  parent_id: string | null,
) {
  if (!parent_id) return;

  if (category_id && parent_id === category_id) {
    throw new AppError(
      400,
      "validation_error",
      "Категория не может быть родителем самой себе",
    );
  }

  const parent = await prisma.categories.findUnique({
    where: { id: parent_id },
  });
  if (!parent) {
    throw new AppError(400, "validation_error", "Родительская категория не найдена");
  }

  if (!category_id) return;

  // Walk ancestors of parent; if we meet category_id → cycle
  let current_id: string | null = parent_id;
  const guard = new Set<string>();
  while (current_id) {
    if (current_id === category_id) {
      throw new AppError(
        400,
        "validation_error",
        "Нельзя создать циклическую вложенность категорий",
      );
    }
    if (guard.has(current_id)) break;
    guard.add(current_id);
    const current = await prisma.categories.findUnique({
      where: { id: current_id },
      select: { parent_id: true },
    });
    current_id = current?.parent_id ?? null;
  }
}

export async function create_category(
  payload: AuthUserPayload,
  input: {
    name: string;
    slug: string;
    parent_id?: string | null;
    sort_order?: number;
    is_active?: boolean;
  },
) {
  assert_catalog_editor(payload);
  await assert_parent_valid(null, input.parent_id ?? null);

  const existing = await prisma.categories.findUnique({
    where: { slug: input.slug },
  });
  if (existing) {
    throw new AppError(409, "conflict", "Slug категории уже используется");
  }

  const category = await prisma.categories.create({
    data: {
      name: input.name.trim(),
      slug: input.slug.trim(),
      parent_id: input.parent_id ?? null,
      sort_order: input.sort_order ?? 0,
      is_active: input.is_active ?? true,
    },
  });

  return { category, message: "Категория создана" };
}

export async function update_category(
  payload: AuthUserPayload,
  category_id: string,
  input: {
    name?: string;
    slug?: string;
    parent_id?: string | null;
    sort_order?: number;
    is_active?: boolean;
  },
) {
  assert_catalog_editor(payload);

  const current = await prisma.categories.findUnique({
    where: { id: category_id },
  });
  if (!current) {
    throw new AppError(404, "not_found", "Категория не найдена");
  }

  if (input.parent_id !== undefined) {
    await assert_parent_valid(category_id, input.parent_id);
  }

  if (input.slug && input.slug !== current.slug) {
    const existing = await prisma.categories.findUnique({
      where: { slug: input.slug },
    });
    if (existing) {
      throw new AppError(409, "conflict", "Slug категории уже используется");
    }
  }

  const category = await prisma.categories.update({
    where: { id: category_id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.slug !== undefined ? { slug: input.slug.trim() } : {}),
      ...(input.parent_id !== undefined ? { parent_id: input.parent_id } : {}),
      ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    },
  });

  return { category, message: "Категория сохранена" };
}
