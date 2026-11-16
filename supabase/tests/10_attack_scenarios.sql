-- Rejoue les attaques connues en tant qu'utilisateur « eleve » (rôle
-- authenticated, non admin). Affiche VULNÉRABLE ou BLOQUÉ pour chacune.
-- Chaque tentative est annulée ensuite (aucun effet de bord).
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.attempt(
  label text, attack_sql text, success_check text,
  uid uuid DEFAULT '00000000-0000-0000-0000-00000000000b',
  claims text DEFAULT '{}',
  legit boolean DEFAULT false   -- true = usage normal qui DOIT réussir
) RETURNS TABLE(attaque text, resultat text) LANGUAGE plpgsql AS $$
DECLARE
  verdict text;
  ok boolean;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', uid::text, true);
    PERFORM set_config('request.jwt.claims', claims, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF success_check IS NULL THEN
      EXECUTE attack_sql INTO ok;           -- la requête renvoie « fuite ? »
      EXECUTE 'RESET ROLE';
    ELSE
      EXECUTE attack_sql;
      EXECUTE 'RESET ROLE';
      EXECUTE success_check INTO ok;        -- vérifié en superutilisateur
    END IF;
    IF legit THEN
      verdict := CASE WHEN coalesce(ok, false) THEN '✅ FONCTIONNE' ELSE '❌ CASSÉ' END;
    ELSE
      verdict := CASE WHEN coalesce(ok, false) THEN '❌ VULNÉRABLE' ELSE '✅ BLOQUÉ' END;
    END IF;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN
    IF verdict IS NULL THEN
      verdict := CASE WHEN legit THEN '❌ CASSÉ (' ELSE '✅ BLOQUÉ (' END || left(SQLERRM, 60) || ')';
    END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  attaque := label; resultat := verdict;
  RETURN NEXT;
END $$;

SELECT * FROM pg_temp.attempt('1. Se donner 9999 crédits (UPDATE profil)',
  $a$UPDATE public.profiles SET credits = 9999 WHERE id = auth.uid()$a$,
  $c$SELECT credits = 9999 FROM public.profiles WHERE username = 'eleve'$c$)
UNION ALL
SELECT * FROM pg_temp.attempt('2. Se nommer admin (UPDATE role)',
  $a$UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid()$a$,
  $c$SELECT role = 'admin' FROM public.profiles WHERE username = 'eleve'$c$)
UNION ALL
SELECT * FROM pg_temp.attempt('3. Admin via user_metadata (modifier un autre profil)',
  $a$UPDATE public.profiles SET credits = 0 WHERE username = 'autre'$a$,
  $c$SELECT credits = 0 FROM public.profiles WHERE username = 'autre'$c$,
  '00000000-0000-0000-0000-00000000000b', '{"user_metadata":{"role":"admin"}}')
UNION ALL
SELECT * FROM pg_temp.attempt('4. consume_credits(-1000) pour gagner des crédits',
  $a$SELECT public.consume_credits(-1000)$a$,
  $c$SELECT credits > 10 FROM public.profiles WHERE username = 'eleve'$c$)
UNION ALL
SELECT * FROM pg_temp.attempt('5. admin_add_credits sur soi-même',
  $a$SELECT public.admin_add_credits(auth.uid(), 5000)$a$,
  $c$SELECT credits > 10 FROM public.profiles WHERE username = 'eleve'$c$)
UNION ALL
SELECT * FROM pg_temp.attempt('6. Lire les clés via get_active_api_keys()',
  $a$SELECT count(*) > 0 FROM public.get_active_api_keys('gemini')$a$, NULL)
UNION ALL
SELECT * FROM pg_temp.attempt('7. Lire les clés dans system_settings',
  $a$SELECT bool_or(admin_contact::text LIKE '%AIza%') FROM public.system_settings$a$, NULL)
UNION ALL
SELECT * FROM pg_temp.attempt('8. Lister les codes coupons',
  $a$SELECT count(*) > 0 FROM public.coupons$a$, NULL)
UNION ALL
SELECT * FROM pg_temp.attempt('9. Approuver sa propre demande de crédits',
  $a$UPDATE public.admin_requests SET status = 'approved' WHERE user_id = auth.uid()$a$,
  $c$SELECT bool_or(status = 'approved') FROM public.admin_requests$c$)
UNION ALL
SELECT * FROM pg_temp.attempt('10. Créditer un autre compte avec un coupon',
  $a$SELECT public.use_coupon('00000000-0000-0000-0000-00000000000c', 'PROMO100')$a$,
  $c$SELECT credits > 10 FROM public.profiles WHERE username = 'autre'$c$);

-- Usages légitimes qui doivent continuer à fonctionner
SELECT * FROM pg_temp.attempt('OK attendu : changer son pseudo / ses préférences',
  $a$UPDATE public.profiles SET username = 'eleve2', preferences = '{"level":"A1"}' WHERE id = auth.uid()$a$,
  $c$SELECT username = 'eleve2' FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000000000b'$c$, legit => true)
UNION ALL
SELECT * FROM pg_temp.attempt('OK attendu : consommer 3 crédits',
  $a$SELECT public.consume_credits(3)$a$,
  $c$SELECT credits = 7 FROM public.profiles WHERE username = 'eleve'$c$, legit => true)
UNION ALL
SELECT * FROM pg_temp.attempt('OK attendu : utiliser un coupon pour soi',
  $a$SELECT public.use_coupon(auth.uid(), 'promo100')$a$,
  $c$SELECT credits = 110 FROM public.profiles WHERE username = 'eleve'$c$, legit => true)
UNION ALL
SELECT * FROM pg_temp.attempt('OK attendu : un admin ajoute 50 crédits',
  $a$SELECT public.admin_add_credits('00000000-0000-0000-0000-00000000000b', 50)$a$,
  $c$SELECT credits = 60 FROM public.profiles WHERE username = 'eleve'$c$,
  '00000000-0000-0000-0000-00000000000a', legit => true);
