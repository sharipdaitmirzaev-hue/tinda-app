"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type CategoryFlat = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  products_count?: number;
  active_products_count?: number;
};

type CategoryNode = CategoryFlat & { children: CategoryNode[] };

const EXPANDED_STORAGE_KEY = "staff_categories_expanded_v1";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "e")
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/[а-я]/gi, (ch) => {
      const map: Record<string, string> = {
        а: "a",
        б: "b",
        в: "v",
        г: "g",
        д: "d",
        е: "e",
        ж: "zh",
        з: "z",
        и: "i",
        й: "y",
        к: "k",
        л: "l",
        м: "m",
        н: "n",
        о: "o",
        п: "p",
        р: "r",
        с: "s",
        т: "t",
        у: "u",
        ф: "f",
        х: "h",
        ц: "ts",
        ч: "ch",
        ш: "sh",
        щ: "sch",
        ъ: "",
        ы: "y",
        ь: "",
        э: "e",
        ю: "yu",
        я: "ya",
      };
      return map[ch] ?? "";
    })
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function collect_descendant_ids(node: CategoryNode): Set<string> {
  const ids = new Set<string>();
  function walk(current: CategoryNode) {
    for (const child of current.children) {
      ids.add(child.id);
      walk(child);
    }
  }
  walk(node);
  return ids;
}

function find_node(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = find_node(node.children, id);
    if (nested) return nested;
  }
  return null;
}

function load_expanded(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function save_expanded(ids: Set<string>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...ids]));
}

export function CategoriesManager() {
  const [tree, set_tree] = useState<CategoryNode[]>([]);
  const [flat, set_flat] = useState<CategoryFlat[]>([]);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [message, set_message] = useState<string | null>(null);
  const [editing_id, set_editing_id] = useState<string | null>(null);
  const [expanded, set_expanded] = useState<Set<string>>(new Set());
  const [form, set_form] = useState({
    name: "",
    slug: "",
    parent_id: "",
    sort_order: "0",
    is_active: true,
  });

  useEffect(() => {
    set_expanded(load_expanded());
  }, []);

  const load = useCallback(async () => {
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch("/api/v1/staff/categories");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось загрузить категории");
      }
      set_tree(data.items ?? []);
      set_flat(data.flat ?? []);
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      set_loading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const excluded_parent_ids = useMemo(() => {
    if (!editing_id) return new Set<string>();
    const node = find_node(tree, editing_id);
    if (!node) return new Set([editing_id]);
    const ids = collect_descendant_ids(node);
    ids.add(editing_id);
    return ids;
  }, [editing_id, tree]);

  function toggle_expanded(id: string) {
    set_expanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      save_expanded(next);
      return next;
    });
  }

  function start_create() {
    set_editing_id(null);
    set_form({
      name: "",
      slug: "",
      parent_id: "",
      sort_order: "0",
      is_active: true,
    });
    set_message(null);
    set_error(null);
  }

  function start_edit(category: CategoryFlat) {
    set_editing_id(category.id);
    set_form({
      name: category.name,
      slug: category.slug,
      parent_id: category.parent_id ?? "",
      sort_order: String(category.sort_order),
      is_active: category.is_active,
    });
    set_message(null);
    set_error(null);
  }

  async function on_submit(event: FormEvent) {
    event.preventDefault();
    set_error(null);
    set_message(null);

    const body = {
      name: form.name,
      slug: form.slug || slugify(form.name),
      parent_id: form.parent_id || null,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
    };

    try {
      const response = await fetch(
        editing_id
          ? `/api/v1/staff/categories/${editing_id}`
          : "/api/v1/staff/categories",
        {
          method: editing_id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось сохранить");
      }
      set_message(data.message ?? "Сохранено");
      const kept_editing = editing_id;
      start_create();
      await load();
      if (kept_editing) {
        set_expanded((prev) => {
          const next = new Set(prev);
          next.add(kept_editing);
          if (body.parent_id) next.add(body.parent_id);
          save_expanded(next);
          return next;
        });
      } else if (body.parent_id) {
        set_expanded((prev) => {
          const next = new Set(prev);
          next.add(body.parent_id as string);
          save_expanded(next);
          return next;
        });
      }
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка сохранения");
    }
  }

  async function toggle_active(category: CategoryFlat) {
    const next = !category.is_active;
    if (category.is_active) {
      const active_count = category.active_products_count ?? 0;
      const ok = window.confirm(
        `Категория и товары внутри неё будут скрыты из клиентского каталога.\n\nАктивных товаров в категории: ${active_count}.\n\nПродолжить деактивацию «${category.name}»?`,
      );
      if (!ok) return;
    }
    set_error(null);
    try {
      const response = await fetch(`/api/v1/staff/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось изменить статус");
      }
      set_message(data.message ?? "Категория сохранена");
      await load();
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Дерево категорий</h2>
          <button
            type="button"
            onClick={start_create}
            className="text-sm text-teal-800 underline"
          >
            Новая категория
          </button>
        </div>
        {loading ? <p className="text-sm text-slate-600">Загрузка…</p> : null}
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900">
            {message}
          </p>
        ) : null}
        {!loading && tree.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-slate-600">
            Категорий пока нет
          </p>
        ) : null}
        <ul className="space-y-1 rounded-lg border border-slate-200 bg-white p-3">
          {tree.map((node) => (
            <CategoryTreeItem
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              on_toggle_expand={toggle_expanded}
              on_edit={start_edit}
              on_toggle={toggle_active}
            />
          ))}
        </ul>
      </div>

      <form
        onSubmit={on_submit}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 className="text-lg font-semibold">
          {editing_id ? "Редактирование категории" : "Создание категории"}
        </h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Название</span>
          <input
            required
            value={form.name}
            onChange={(e) =>
              set_form((prev) => ({
                ...prev,
                name: e.target.value,
                slug: prev.slug || slugify(e.target.value),
              }))
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Slug</span>
          <input
            required
            value={form.slug}
            onChange={(e) => set_form((prev) => ({ ...prev, slug: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Родительская категория</span>
          <select
            value={form.parent_id}
            onChange={(e) =>
              set_form((prev) => ({ ...prev, parent_id: e.target.value }))
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Без родителя</option>
            {flat
              .filter((item) => !excluded_parent_ids.has(item.id))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Порядок сортировки</span>
          <input
            type="number"
            value={form.sort_order}
            onChange={(e) =>
              set_form((prev) => ({ ...prev, sort_order: e.target.value }))
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) =>
              set_form((prev) => ({ ...prev, is_active: e.target.checked }))
            }
          />
          Активна
        </label>
        <button
          type="submit"
          className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800"
        >
          Сохранить
        </button>
      </form>
    </div>
  );
}

function CategoryTreeItem({
  node,
  depth,
  expanded,
  on_toggle_expand,
  on_edit,
  on_toggle,
}: {
  node: CategoryNode;
  depth: number;
  expanded: Set<string>;
  on_toggle_expand: (id: string) => void;
  on_edit: (category: CategoryFlat) => void;
  on_toggle: (category: CategoryFlat) => void;
}) {
  const has_children = node.children.length > 0;
  const is_open = expanded.has(node.id);
  const products_count = node.products_count ?? 0;
  const active_products_count = node.active_products_count ?? 0;

  return (
    <li>
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {has_children ? (
            <button
              type="button"
              onClick={() => on_toggle_expand(node.id)}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-xs text-slate-700"
              aria-label={is_open ? "Свернуть" : "Развернуть"}
            >
              {is_open ? "−" : "+"}
            </button>
          ) : (
            <span className="inline-block h-6 w-6" />
          )}
          <div className="min-w-0">
            <span className="font-medium text-slate-900">{node.name}</span>
            <span className="ml-2 text-xs text-slate-500">{node.slug}</span>
            <span className="ml-2 text-xs text-slate-500">
              товаров: {products_count}
              {active_products_count !== products_count
                ? ` (активных: ${active_products_count})`
                : ""}
            </span>
            {!node.is_active ? (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                Неактивна
              </span>
            ) : (
              <span className="ml-2 text-xs text-teal-800">Активна</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => on_edit(node)}
            className="text-teal-800 underline"
          >
            Изменить
          </button>
          <button
            type="button"
            onClick={() => on_toggle(node)}
            className="text-slate-700 underline"
          >
            {node.is_active ? "Деактивировать" : "Активировать"}
          </button>
        </div>
      </div>
      {has_children && is_open ? (
        <ul>
          {node.children.map((child) => (
            <CategoryTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              on_toggle_expand={on_toggle_expand}
              on_edit={on_edit}
              on_toggle={on_toggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
