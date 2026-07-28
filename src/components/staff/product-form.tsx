"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DragEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { SALE_UNITS } from "@/lib/catalog/constants";
import { UI_GENERIC_ERROR, UI_LOAD_ERROR } from "@/lib/i18n/ui-copy";

type CategoryFlat = { id: string; name: string };

type ProductFormValues = {
  sku: string;
  name: string;
  brand: string;
  category_id: string;
  volume_text: string;
  package_type: string;
  units_per_package: string;
  sale_unit: string;
  min_order_qty: string;
  allow_piece_sale: boolean;
  description: string;
  availability: string;
  sales_status: string;
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  image_url: string;
  is_active: boolean;
  price_amount: string; // empty = null
};

const empty_form: ProductFormValues = {
  sku: "",
  name: "",
  brand: "",
  category_id: "",
  volume_text: "",
  package_type: "",
  units_per_package: "1",
  sale_unit: "упаковка",
  min_order_qty: "1",
  allow_piece_sale: false,
  description: "",
  availability: "in_stock",
  sales_status: "showcase",
  is_promo: false,
  is_new: false,
  is_hit: false,
  image_url: "",
  is_active: true,
  price_amount: "",
};

type Props = {
  product_id?: string;
  initial?: Partial<ProductFormValues>;
};

export function ProductForm({ product_id, initial }: Props) {
  const router = useRouter();
  const file_input_ref = useRef<HTMLInputElement>(null);
  const [categories, set_categories] = useState<CategoryFlat[]>([]);
  const [form, set_form] = useState<ProductFormValues>({
    ...empty_form,
    ...initial,
  });
  const [pending_file, set_pending_file] = useState<File | null>(null);
  const [preview_url, set_preview_url] = useState<string | null>(null);
  const [loading, set_loading] = useState(false);
  const [uploading, set_uploading] = useState(false);
  const [drag_over, set_drag_over] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [message, set_message] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/staff/categories")
      .then((res) => res.json())
      .then((data) => set_categories(data.flat ?? []))
      .catch(() => set_categories([]));
  }, []);

  useEffect(() => {
    return () => {
      if (preview_url) URL.revokeObjectURL(preview_url);
    };
  }, [preview_url]);

  function set_field<K extends keyof ProductFormValues>(
    key: K,
    value: ProductFormValues[K],
  ) {
    set_form((prev) => ({ ...prev, [key]: value }));
  }

  function clear_pending_file() {
    if (preview_url) URL.revokeObjectURL(preview_url);
    set_preview_url(null);
    set_pending_file(null);
    if (file_input_ref.current) file_input_ref.current.value = "";
  }

  function choose_file(file: File | null) {
    if (!file) return;
    clear_pending_file();
    set_pending_file(file);
    set_preview_url(URL.createObjectURL(file));
    set_field("image_url", "");
    set_error(null);
    set_message(null);
  }

  function on_drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    set_drag_over(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    choose_file(file);
  }

  async function upload_image_for_product(id: string, file: File) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`/api/v1/staff/products/${id}/image`, {
      method: "POST",
      body,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message ?? "Не удалось загрузить изображение");
    }
    return data.image_url as string;
  }

  async function on_submit(event: FormEvent) {
    event.preventDefault();
    set_loading(true);
    set_uploading(Boolean(pending_file));
    set_error(null);
    set_message(null);

    const use_manual_url = !pending_file;
    const body = {
      sku: form.sku,
      name: form.name,
      brand: form.brand || null,
      category_id: form.category_id,
      volume_text: form.volume_text || null,
      package_type: form.package_type || null,
      units_per_package: Number(form.units_per_package),
      sale_unit: form.sale_unit,
      min_order_qty: Number(form.min_order_qty),
      allow_piece_sale: form.allow_piece_sale,
      description: form.description || null,
      availability: form.availability,
      sales_status: form.sales_status,
      is_promo: form.is_promo,
      is_new: form.is_new,
      is_hit: form.is_hit,
      image_url: use_manual_url ? form.image_url || null : undefined,
      is_active: form.is_active,
      price_amount: form.price_amount.trim() === "" ? null : Number(form.price_amount),
      price_currency: "RUB" as const,
    };

    try {
      const response = await fetch(
        product_id
          ? `/api/v1/staff/products/${product_id}`
          : "/api/v1/staff/products",
        {
          method: product_id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось сохранить товар");
      }

      const saved_id = product_id ?? (data.product?.id as string | undefined);
      if (!saved_id) {
        throw new Error("Не удалось получить идентификатор товара");
      }

      if (pending_file) {
        const image_url = await upload_image_for_product(saved_id, pending_file);
        set_field("image_url", image_url);
        clear_pending_file();
        set_message("Товар сохранён, изображение загружено");
      } else {
        set_message("Товар сохранён");
      }

      router.push("/staff/products?flash=saved");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_loading(false);
      set_uploading(false);
    }
  }

  async function on_replace_image() {
    if (!product_id || !pending_file) return;
    set_uploading(true);
    set_error(null);
    set_message(null);
    try {
      const image_url = await upload_image_for_product(product_id, pending_file);
      set_field("image_url", image_url);
      clear_pending_file();
      set_message("Изображение обновлено");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_LOAD_ERROR);
    } finally {
      set_uploading(false);
    }
  }

  async function on_delete_image() {
    if (!product_id) return;
    if (!window.confirm("Удалить изображение товара?")) return;
    set_uploading(true);
    set_error(null);
    set_message(null);
    try {
      const response = await fetch(`/api/v1/staff/products/${product_id}/image`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось удалить изображение");
      }
      clear_pending_file();
      set_field("image_url", "");
      set_message("Изображение удалено");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_uploading(false);
    }
  }

  async function on_deactivate() {
    if (!product_id) return;
    if (
      !window.confirm(
        "Товар будет скрыт из клиентского каталога. Продолжить?",
      )
    ) {
      return;
    }
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/staff/products/${product_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось деактивировать");
      }
      set_field("is_active", false);
      set_message("Товар деактивирован");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_loading(false);
    }
  }

  async function on_activate() {
    if (!product_id) return;
    set_loading(true);
    set_error(null);
    try {
      const response = await fetch(`/api/v1/staff/products/${product_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Не удалось активировать");
      }
      set_field("is_active", true);
      set_message("Товар активирован");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : UI_GENERIC_ERROR);
    } finally {
      set_loading(false);
    }
  }

  const display_src = preview_url || form.image_url || null;

  return (
    <form onSubmit={on_submit} className="space-y-4 rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {product_id ? "Редактирование товара" : "Новый товар"}
          </h1>
          {product_id ? (
            <p className="mt-1 text-sm text-slate-600">
              Статус:{" "}
              {form.is_active ? (
                <span className="text-teal-800">Активен</span>
              ) : (
                <span className="text-amber-700">Неактивен</span>
              )}
            </p>
          ) : null}
        </div>
        <Link href="/staff/products" className="text-sm text-teal-800 underline">
          К списку
        </Link>
      </div>

      <section className="space-y-3 rounded-md border border-slate-200 p-3">
        <h2 className="text-sm font-semibold text-slate-800">Фотография</h2>
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <ProductImage
            src={display_src}
            alt={form.name || "Превью"}
            className="h-36 w-36"
          />
          <div className="flex-1 space-y-3">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                set_drag_over(true);
              }}
              onDragLeave={() => set_drag_over(false)}
              onDrop={on_drop}
              className={`rounded-md border border-dashed px-4 py-6 text-center text-sm ${
                drag_over
                  ? "border-teal-600 bg-teal-50"
                  : "border-slate-300 bg-slate-50"
              }`}
            >
              <p className="text-slate-700">
                Перетащите JPG, PNG или WebP сюда
              </p>
              <p className="mt-1 text-xs text-slate-500">Максимум 5 МБ</p>
              <button
                type="button"
                onClick={() => file_input_ref.current?.click()}
                className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
              >
                Выбрать изображение
              </button>
              <input
                ref={file_input_ref}
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(event) =>
                  choose_file(event.target.files?.[0] ?? null)
                }
              />
            </div>
            {pending_file ? (
              <p className="text-xs text-slate-600">
                Выбран файл: {pending_file.name}
              </p>
            ) : null}
            {uploading ? (
              <p className="text-sm text-teal-800">Загрузка изображения…</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {product_id && pending_file ? (
                <button
                  type="button"
                  onClick={on_replace_image}
                  disabled={uploading || loading}
                  className="rounded-md border border-teal-700 px-3 py-1.5 text-sm text-teal-800 disabled:opacity-60"
                >
                  Заменить
                </button>
              ) : null}
              {product_id && (form.image_url || pending_file) ? (
                <button
                  type="button"
                  onClick={on_delete_image}
                  disabled={uploading || loading}
                  className="rounded-md border border-amber-300 px-3 py-1.5 text-sm text-amber-800 disabled:opacity-60"
                >
                  Удалить изображение
                </button>
              ) : null}
              {pending_file ? (
                <button
                  type="button"
                  onClick={clear_pending_file}
                  disabled={uploading}
                  className="rounded-md border px-3 py-1.5 text-sm text-slate-700"
                >
                  Отменить выбор
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Артикул" required>
          <input
            required
            value={form.sku}
            onChange={(e) => set_field("sku", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </Field>
        <Field label="Название" required>
          <input
            required
            value={form.name}
            onChange={(e) => set_field("name", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </Field>
        <Field label="Бренд">
          <input
            value={form.brand}
            onChange={(e) => set_field("brand", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </Field>
        <Field label="Категория" required>
          <select
            required
            value={form.category_id}
            onChange={(e) => set_field("category_id", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          >
            <option value="">Выберите категорию</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Объём / вес">
          <input
            value={form.volume_text}
            onChange={(e) => set_field("volume_text", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </Field>
        <Field label="Тип упаковки">
          <input
            value={form.package_type}
            onChange={(e) => set_field("package_type", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </Field>
        <Field label="Шт. в упаковке" required>
          <input
            required
            type="number"
            min={1}
            value={form.units_per_package}
            onChange={(e) => set_field("units_per_package", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </Field>
        <Field label="Единица продажи" required>
          <select
            required
            value={form.sale_unit}
            onChange={(e) => set_field("sale_unit", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          >
            {SALE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Мин. заказ" required>
          <input
            required
            type="number"
            min={1}
            value={form.min_order_qty}
            onChange={(e) => set_field("min_order_qty", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </Field>
        <Field label="Режим продажи" required>
          <select
            required
            value={form.sales_status}
            onChange={(e) => set_field("sales_status", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          >
            <option value="showcase">Витрина</option>
            <option value="on_request">Цена по запросу</option>
            <option value="orderable">Доступен для заказа</option>
          </select>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              onClick={() => set_field("sales_status", "orderable")}
            >
              Открыть продажи
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              onClick={() => set_field("sales_status", "showcase")}
            >
              Перевести в витрину
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              onClick={() => set_field("sales_status", "on_request")}
            >
              Цена по запросу
            </button>
          </div>
        </Field>
        <Field
          label={
            form.sales_status === "orderable"
              ? "Цена, ₽ (обязательна)"
              : "Цена, ₽ (необязательна)"
          }
          required={form.sales_status === "orderable"}
        >
          <input
            required={form.sales_status === "orderable"}
            type="number"
            min={0}
            step="0.01"
            value={form.price_amount}
            onChange={(e) => set_field("price_amount", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Пусто = без цены"
          />
        </Field>
        <Field label="Наличие" required>
          <select
            required
            value={form.availability}
            onChange={(e) => set_field("availability", e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          >
            <option value="in_stock">В наличии</option>
            <option value="on_order">Под заказ</option>
            <option value="out_of_stock">Временно нет</option>
          </select>
        </Field>
      </div>

      <Field label="Описание">
        <textarea
          rows={4}
          value={form.description}
          onChange={(e) => set_field("description", e.target.value)}
          className="w-full rounded-md border px-3 py-2"
        />
      </Field>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.allow_piece_sale}
            onChange={(e) => set_field("allow_piece_sale", e.target.checked)}
          />
          Поштучная продажа
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_promo}
            onChange={(e) => set_field("is_promo", e.target.checked)}
          />
          Акция
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_new}
            onChange={(e) => set_field("is_new", e.target.checked)}
          />
          Новинка
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_hit}
            onChange={(e) => set_field("is_hit", e.target.checked)}
          />
          Хит
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set_field("is_active", e.target.checked)}
          />
          Активен
        </label>
      </div>

      <details className="rounded-md border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          Дополнительно
        </summary>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium">Адрес изображения (вручную)</span>
          <input
            value={form.image_url}
            onChange={(e) => {
              clear_pending_file();
              set_field("image_url", e.target.value);
            }}
            placeholder="https://... или /uploads/..."
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            disabled={Boolean(pending_file)}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Используйте либо загруженный файл, либо ручную ссылку — не оба сразу.
          </span>
        </label>
      </details>

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

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={loading || uploading}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {loading || uploading ? "Сохранение…" : "Сохранить"}
        </button>
        {product_id && form.is_active ? (
          <button
            type="button"
            onClick={on_deactivate}
            disabled={loading || uploading}
            className="rounded-md border border-amber-300 px-4 py-2 text-sm text-amber-800"
          >
            Деактивировать товар
          </button>
        ) : null}
        {product_id && !form.is_active ? (
          <button
            type="button"
            onClick={on_activate}
            disabled={loading || uploading}
            className="rounded-md border border-teal-700 px-4 py-2 text-sm text-teal-800"
          >
            Активировать товар
          </button>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
