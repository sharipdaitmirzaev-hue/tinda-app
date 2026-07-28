"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type CityItem = { id: string; name: string; region: string };

const CLIENT_TYPES = [
  { value: "", label: "Не указан" },
  { value: "shop", label: "Магазин" },
  { value: "cafe", label: "Кафе" },
  { value: "restaurant", label: "Ресторан" },
  { value: "hotel", label: "Гостиница" },
  { value: "wholesaler", label: "Оптовик" },
  { value: "banquet_hall", label: "Банкетный зал" },
  { value: "other", label: "Другое" },
];

export function RegisterForm() {
  const router = useRouter();
  const [cities, set_cities] = useState<CityItem[]>([]);
  const [error, set_error] = useState<string | null>(null);
  const [loading, set_loading] = useState(false);
  const [pdn_accepted, set_pdn_accepted] = useState(false);

  useEffect(() => {
    fetch("/api/v1/cities")
      .then((res) => res.json())
      .then((data) => set_cities(data.items ?? []))
      .catch(() => set_cities([]));
  }, []);

  async function on_submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    set_error(null);
    set_loading(true);

    const form = new FormData(event.currentTarget);
    const client_type_raw = String(form.get("client_type") ?? "");
    const payload = {
      company_name: String(form.get("company_name") ?? ""),
      inn: String(form.get("inn") ?? ""),
      kpp: String(form.get("kpp") ?? "") || null,
      legal_name: String(form.get("legal_name") ?? "") || null,
      legal_address: String(form.get("legal_address") ?? "") || null,
      city_id: String(form.get("city_id") ?? ""),
      client_type: client_type_raw || null,
      contact_name: String(form.get("contact_name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      extra_phone: String(form.get("extra_phone") ?? "") || null,
      email: String(form.get("email") ?? ""),
      address: String(form.get("address") ?? ""),
      comment: String(form.get("comment") ?? "") || null,
      password: String(form.get("password") ?? ""),
      password_confirm: String(form.get("password_confirm") ?? ""),
      pdn_accepted,
    };

    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        set_error(data?.error?.message ?? "Не удалось отправить заявку");
        return;
      }

      router.replace(data.redirect_to ?? "/pending");
      router.refresh();
    } catch {
      set_error("Нет соединения. Проверьте интернет.");
    } finally {
      set_loading(false);
    }
  }

  return (
    <form onSubmit={on_submit} className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-800">Компания</legend>
        <Field label="Название компании / точки" name="company_name" required />
        <Field label="ИНН" name="inn" required />
        <Field label="КПП" name="kpp" />
        <Field label="Юридическое наименование" name="legal_name" />
        <Field label="Юридический адрес" name="legal_address" />
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="city_id">
            Город
          </label>
          <select
            id="city_id"
            name="city_id"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            defaultValue=""
          >
            <option value="" disabled>
              Выберите город
            </option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="client_type">
            Тип клиента
          </label>
          <select
            id="client_type"
            name="client_type"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            defaultValue=""
          >
            {CLIENT_TYPES.map((item) => (
              <option key={item.value || "none"} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <Field label="Адрес точки / доставки" name="address" required />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-800">Контакты</legend>
        <Field label="Контактное лицо" name="contact_name" required />
        <Field label="Телефон" name="phone" required />
        <Field label="Дополнительный телефон" name="extra_phone" />
        <Field label="Эл. почта" name="email" type="email" required />
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="comment">
            Комментарий
          </label>
          <textarea
            id="comment"
            name="comment"
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-800">Доступ</legend>
        <Field label="Пароль" name="password" type="password" required />
        <Field
          label="Подтверждение пароля"
          name="password_confirm"
          type="password"
          required
        />
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={pdn_accepted}
            onChange={(e) => set_pdn_accepted(e.target.checked)}
            className="mt-1"
          />
          <span>
            Соглашаюсь на обработку персональных данных. Без согласия заявка не
            будет принята.
          </span>
        </label>
      </fieldset>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-teal-700 px-4 py-2.5 text-white hover:bg-teal-800 disabled:opacity-60"
      >
        {loading ? "Отправка…" : "Отправить заявку"}
      </button>

      <p className="text-center text-sm text-slate-600">
        Уже есть аккаунт?{" "}
        <Link href="/login" className="text-teal-800 underline">
          Войти
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full rounded-md border border-slate-300 px-3 py-2"
      />
    </div>
  );
}
