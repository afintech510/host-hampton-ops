-- ══════════════════════════════════════════════════════════════
-- Seed: Spanish (es) self-run party room rental landing page (DRAFT)
--
--   Bilingual counterpart of the English static page /party-room-rental.
--   Served by the DB renderer at /es/party-room-rental (app/[...slug] is
--   locale-aware: an `es/` path prefix selects locale='es').
--
--   Lands as a DRAFT. Per Adam, the Spanish is reviewed by AI agents (a
--   cross-provider pass, e.g. Gemini) BEFORE it is approved/published from the
--   Marketing tab — this seed is the reviewable first draft, not final copy.
--
--   NOT child media (references_child_media stays false), so not consent-gated.
--   Slug matches the English page's slug so hreflang alternates line up:
--     en → https://www.hosthampton.com/party-room-rental   (static page)
--     es → https://www.hosthampton.com/es/party-room-rental (this row)
--
-- Run AFTER migration_022. Idempotent on (slug, locale). Apply BY HAND in the
-- Supabase SQL editor — never auto-applied.
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.website_content
  (slug, page_type, title, meta_description, locale, status, created_by, structured)
VALUES (
  'party-room-rental',
  'landing',
  'Alquiler de Salón para Fiestas en Speonk, NY | Host Hampton',
  'Alquila nuestro salón privado en Speonk, NY para cumpleaños, baby showers, sesiones de fotos, talleres y más. Desde $450 por 3 horas. Organiza tu evento a tu manera.',
  'es',
  'draft',
  'manual',
  jsonb_build_object(
    'sections', jsonb_build_array(
      jsonb_build_object(
        'heading', 'Tu espacio, tu evento',
        'text', 'Alquila nuestro salón privado en Speonk y organiza tu celebración exactamente como la imaginas. Sin paquetes obligatorios ni reglas complicadas: el espacio es tuyo para decorarlo y organizarlo a tu gusto. Perfecto para cumpleaños, baby showers, despedidas de soltera, sesiones de fotos y mucho más.'
      ),
      jsonb_build_object(
        'heading', 'Qué incluye el alquiler',
        'text', 'Mesas, sillas, iluminación básica, WiFi, sistema de sonido Bluetooth, un área de preparación y acceso al baño están incluidos. Tú traes la comida, las decoraciones y a tus proveedores; nosotros te proporcionamos el espacio listo para ti.'
      ),
      jsonb_build_object(
        'heading', 'Ideal para',
        'text', 'Cumpleaños de todas las edades, baby showers, despedidas de soltera, sesiones de fotos y creación de contenido, pop-ups de belleza, talleres de arte y manualidades, tiendas temporales, reuniones de equipo y capacitaciones.'
      ),
      jsonb_build_object(
        'heading', 'Precios',
        'text', 'Entre semana (lun a vie): $450 por 3 horas. Fin de semana (sáb y dom): $575 por 3 horas. Día completo entre semana: $700 por 12 horas. Día completo de fin de semana: $975 por 12 horas. Se cobra por separado un depósito de seguridad reembolsable de $500.'
      )
    ),
    'faq', jsonb_build_array(
      jsonb_build_object(
        'q', '¿Qué incluye el alquiler del salón?',
        'a', 'Mesas, sillas, iluminación básica, WiFi, sistema de sonido Bluetooth, un área de preparación y acceso al baño. El espacio es tuyo para decorarlo y organizarlo como quieras: tú traes todo lo demás.'
      ),
      jsonb_build_object(
        'q', '¿Puedo traer mi propia comida y mis proveedores?',
        'a', 'Por supuesto. Puedes traer comida, bebidas, decoraciones y proveedores de afuera. No hay restricciones para el catering externo.'
      ),
      jsonb_build_object(
        'q', '¿Cuál es el depósito de seguridad?',
        'a', 'Un depósito de seguridad reembolsable de $500 se cobra por separado antes de tu evento. Se devuelve en su totalidad después de una inspección posterior que confirme que el espacio quedó en buenas condiciones.'
      )
    ),
    'gallery', jsonb_build_array(
      '/images/gallery/venue-construction-party.webp',
      '/images/gallery/venue-painting-workshop.webp',
      '/images/gallery/venue-craft-station.webp',
      '/images/gallery/activity-bracelet-making.webp'
    )
  )::jsonb
)
ON CONFLICT (slug, locale) DO NOTHING;

SELECT slug, status, locale FROM public.website_content WHERE slug = 'party-room-rental';
