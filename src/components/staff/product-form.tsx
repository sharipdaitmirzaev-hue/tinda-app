"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { SALE_UNITS } from "@/lib/catalog/constants";

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
  is_promo: boolean;
  is_new: boolean;
  is_hit: boolean;
  image_url: string;
  is_active: boolean;
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
  is_promo: false,
  is_new: false,
  is_hit: false,
  image_url: "",
  is_active: true,
};

type Props = {
  product_id?: string;
  initial?: Partial<ProductFormValues>;
};

export function ProductForm({ product_id, initial }: Props) {
  const router = useRouter();
  const [categories, set_categories] = useState<CategoryFlat[]>([]);
  const [form, set_form] = useState<ProductFormValues>({
    ...empty_form,
    ...initial,
  });
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/staff/categories")
      .then((res) => res.json())
      .then((data) => set_categories(data.flat ?? []))
      .catch(() => set_categories([]));
  }, []);

  function set_field<K extends keyof ProductFormValues>(
    key: K,
    value: ProductFormValues[K],
  ) {
    set_form((prev) => ({ ...prev, [key]: value }));
  }

  async function on_submit(event: FormEvent) {
    event.preventDefault();
    set_loading(true);
    set_error(null);

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
      is_promo: form.is_promo,
      is_new: form.is_new,
      is_hit: form.is_hit,
      image_url: form.image_url || null,
      is_active: form.is_active,
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
      router.push("/staff/products?flash=saved");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      set_loading(false);
    }
  }

  async function on_deactivate() {
    if (!product_id) return;
    if (!window.confirm("Деактивировать товар? Он исчезнет из клиентского каталога.")) {
      return;
    }
    set_field("is_active", false);
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
      router.push("/staff/products?flash=saved");
      router.refresh();
    } catch (err) {
      set_error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      set_loading(false);
    }
  }

  return (
    <form onSubmit={on_submit} className="space-y-4 rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {product_id ? "Редактирование товара" : "Новый товар"}
        </h1>
        <Link href="/staff/products" className="text-sm text-teal-800 underline">
          К списку
        </Link>
      </div>

      <div className="flex items-start gap-4">
        <ProductImage
          src={form.image_url || null}
          alt={form.name || "Превью"}
          className="h-28 w-28"
        />
        <label className="block flex-1 text-sm">
          <span className="mb-1 block font-medium">URL изображения</span>
          <input
            value={form.image_url}
            onChange={(e) => set_field("image_url", e.target.value)}
            placeholder="https://..."
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Загрузка файла с компьютера будет в Э1.12
          </span>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Артикул (SKU)" required>
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

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {loading ? "Сохранение…" : "Сохранить"}
        </button>
        {product_id ? (
          <button
            type="button"
            onClick={on_deactivate}
            disabled={loading}
            className="rounded-md border border-amber-300 px-4 py-2 text-sm text-amber-800"
          >
            Деактивировать
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
