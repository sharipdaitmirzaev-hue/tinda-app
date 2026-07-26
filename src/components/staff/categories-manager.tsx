"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type CategoryFlat = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
};

type CategoryNode = CategoryFlat & { children: CategoryNode[] };

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

export function CategoriesManager() {
  const [tree, set_tree] = useState<CategoryNode[]>([]);
  const [flat, set_flat] = useState<CategoryFlat[]>([]);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [message, set_message] = useState<string | null>(null);
  const [editing_id, set_editing_id] = useState<string | null>(null);
  const [form, set_form] = useState({
    name: "",
    slug: "",
    parent_id: "",
    sort_order: "0",
    is_active: true,
  });

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
      start_create();
      await load();
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка сохранения");
    }
  }

  async function toggle_active(category: CategoryFlat) {
    const next = !category.is_active;
    if (
      category.is_active &&
      !window.confirm(
        `Отключить категорию «${category.name}»? Дочерние категории не удаляются.`,
      )
    ) {
      return;
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
              .filter((item) => item.id !== editing_id)
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
  on_edit,
  on_toggle,
}: {
  node: CategoryNode;
  depth: number;
  on_edit: (category: CategoryFlat) => void;
  on_toggle: (category: CategoryFlat) => void;
}) {
  return (
    <li>
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <div>
          <span className="font-medium text-slate-900">{node.name}</span>
          <span className="ml-2 text-xs text-slate-500">{node.slug}</span>
          {!node.is_active ? (
            <span className="ml-2 text-xs text-amber-700">выкл.</span>
          ) : null}
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
            {node.is_active ? "Отключить" : "Включить"}
          </button>
        </div>
      </div>
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <CategoryTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              on_edit={on_edit}
              on_toggle={on_toggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
