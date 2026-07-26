import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { hash_password, verify_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import type { AuthUserPayload } from "@/lib/access";
import {
  empty_to_null,
  type LoginInput,
  type RegisterInput,
} from "@/lib/validators/auth";

function normalize_phone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

export async function register_client(
  input: RegisterInput,
): Promise<AuthUserPayload> {
  const email = input.email.trim().toLowerCase();
  const inn = input.inn.trim();
  const phone = normalize_phone(input.phone);

  const city = await prisma.cities.findFirst({
    where: { id: input.city_id, is_active: true },
  });
  if (!city) {
    throw new AppError(400, "validation_error", "Выбранный город недоступен");
  }

  const existing_email = await prisma.users.findUnique({ where: { email } });
  if (existing_email) {
    throw new AppError(409, "conflict", "Email уже используется");
  }

  const existing_inn = await prisma.clients.findUnique({ where: { inn } });
  if (existing_inn) {
    throw new AppError(409, "conflict", "ИНН уже зарегистрирован");
  }

  const role_client = await prisma.roles.findUnique({
    where: { code: "client" },
  });
  if (!role_client) {
    throw new AppError(
      500,
      "internal_error",
      "Роль клиента не настроена. Выполните seed базы данных.",
    );
  }

  const password_hash = await hash_password(input.password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.users.create({
      data: {
        email,
        phone,
        password_hash,
        full_name: input.contact_name.trim(),
        user_roles: {
          create: [{ role_id: role_client.id }],
        },
        client: {
          create: {
            company_name: input.company_name.trim(),
            inn,
            kpp: empty_to_null(input.kpp),
            legal_name: empty_to_null(input.legal_name),
            legal_address: empty_to_null(input.legal_address),
            city_id: input.city_id,
            client_type: input.client_type ?? null,
            status: "pending",
            contact_name: input.contact_name.trim(),
            phone,
            extra_phone: empty_to_null(input.extra_phone)
              ? normalize_phone(input.extra_phone as string)
              : null,
            email,
            comment: empty_to_null(input.comment),
            address: input.address.trim(),
            pdn_accepted_at: new Date(),
          },
        },
      },
    });

    return user;
  });

  const payload = await build_auth_payload(created.id);
  if (!payload) {
    throw new AppError(500, "internal_error", "Не удалось создать пользователя");
  }
  return payload;
}

export async function login_user(input: LoginInput): Promise<AuthUserPayload> {
  const login = input.login.trim().toLowerCase();
  const phone_login = normalize_phone(input.login.trim());

  const user = await prisma.users.findFirst({
    where: {
      OR: [{ email: login }, { phone: phone_login }, { phone: input.login.trim() }],
    },
    include: {
      client: true,
      user_roles: { include: { role: true } },
    },
  });

  if (!user || !user.is_active) {
    throw new AppError(401, "unauthorized", "Неверный логин или пароль");
  }

  const password_ok = await verify_password(input.password, user.password_hash);
  if (!password_ok) {
    throw new AppError(401, "unauthorized", "Неверный логин или пароль");
  }

  // blocked clients may log in to see the status screen, but shop routes stay closed

  const payload = await build_auth_payload(user.id);
  if (!payload) {
    throw new AppError(401, "unauthorized", "Неверный логин или пароль");
  }
  return payload;
}
