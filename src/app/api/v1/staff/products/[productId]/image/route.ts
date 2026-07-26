import { NextResponse } from "next/server";
import { get_current_auth_payload } from "@/lib/auth/current-user";
import { assert_catalog_editor } from "@/lib/catalog/assert-editor";
import { AppError, api_error } from "@/lib/http/errors";
import {
  remove_product_image,
  upload_product_image,
} from "@/lib/services/products.service";
import { PRODUCT_IMAGE_MAX_BYTES } from "@/lib/storage/product-images";

type RouteContext = { params: Promise<{ productId: string }> };

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    assert_catalog_editor(payload);

    const content_length = request.headers.get("content-length");
    if (content_length) {
      const size = Number(content_length);
      // Allow multipart overhead above the raw 5 MB file limit.
      if (Number.isFinite(size) && size > PRODUCT_IMAGE_MAX_BYTES + 1024 * 256) {
        return api_error(
          400,
          "validation_error",
          "Размер файла не должен превышать 5 МБ",
        );
      }
    }

    const { productId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return api_error(400, "validation_error", "Выберите файл изображения");
    }

    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      return api_error(
        400,
        "validation_error",
        "Размер файла не должен превышать 5 МБ",
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await upload_product_image(payload, productId, {
      buffer,
      mime_type: file.type,
      filename: file.name,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("staff product image upload error", error);
    return api_error(500, "internal_error", "Не удалось загрузить изображение");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const payload = await get_current_auth_payload();
    if (!payload) {
      return api_error(401, "unauthorized", "Требуется вход в систему");
    }
    assert_catalog_editor(payload);

    const { productId } = await context.params;
    const result = await remove_product_image(payload, productId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      return api_error(error.status, error.code, error.message);
    }
    console.error("staff product image delete error", error);
    return api_error(500, "internal_error", "Не удалось удалить изображение");
  }
}
