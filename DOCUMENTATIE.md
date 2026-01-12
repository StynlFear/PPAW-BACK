# Documentație proiect – PPAW Backend

## 1) Prezentare generală
Acest proiect este un backend TypeScript/Node.js construit pe **Express**, cu acces la o bază de date **PostgreSQL** prin **Prisma** și cu stocare fișiere (imagini) în **Supabase Storage**. Proiectul expune o API de tip REST și include documentație OpenAPI/Swagger.

- Specificație OpenAPI: `openapi.yaml`
- Swagger UI (când rulează aplicația): `http://localhost:3000/docs`
- OpenAPI YAML servit din aplicație: `http://localhost:3000/openapi.yaml`

Funcționalități principale (pe scurt):
- autentificare cu email/parolă + JWT
- utilizatori (profil)
- planuri și abonamente (Free/Paid)
- limitare utilizare (quota) pe lună (număr imagini + spațiu)
- upload imagini în Supabase Storage
- aplicare „filtre” pe imagini (istoric prin versiuni)
- watermark-uri (preseturi + aplicare + istoric)
- plăți simulate (checkout „fake” pentru demo)
- rapoarte agregate (ex: activitate, plăți, trends)


## 2) Proiectare

### 2.1 Paradigme utilizate

#### a) API REST (HTTP JSON)
Proiectul expune endpoint-uri HTTP, în majoritate JSON, respectând un stil REST:
- resurse: `/users`, `/images`, `/filters`, `/plans`, `/watermarks`, `/payments`, `/reports`
- metode: `GET` (citire), `POST` (creare/acțiune), `PUT` (înlocuire/actualizare), `DELETE` (ștergere)

#### b) Arhitectură pe straturi (stil „MVC” adaptat la backend)
Deși nu există „View” (nu e aplicație web cu pagini), proiectul folosește o separare clară:
- **Routes** (rutare): `src/routes/*` — mapează URL-urile pe controllere
- **Controllers**: `src/controllers/*` — validare input, orchestration, cod HTTP, shape răspuns
- **Models (Data access / business helpers)**: `src/models/*` — interogări/transaction DB, reguli de acces la date
- **Config**: `src/config/*` — configurare DB, auth, supabase
- **Middleware**: `src/middleware/*` — autentificare (JWT)
- **Utils**: `src/utils/*` — utilitare (JWT, validatori)

Această separare este similară cu MVC, dar în practică este mai aproape de „**Controller + Service/Model + Repository**” (în acest proiect, „models” includ partea de acces la DB și bucăți de logică de domeniu).

#### c) ORM (Prisma) – „hybrid” între Code First și Database First
- Există un fișier Prisma schema: `prisma/schema.prisma` (modele, relații, mapări).
- Clientul Prisma se generează (`npm run prisma:generate`) și este folosit în `src/models/*`.
- Totuși, repo-ul **nu conține Prisma migrations**; modificările de schema DB sunt ținute ca **scripturi SQL** în `prisma/sql/`.

Interpretare practică:
- **Database First / SQL-first** pentru evoluția bazei de date (se aplică SQL-urile în ordine)
- **Prisma schema** este menținută sincron cu DB pentru a genera clientul tipizat (beneficiu „code-first” la nivel de cod)

#### d) Middleware pentru cross-cutting concerns
Exemple:
- `requireAuth` pentru protejarea endpoint-ului `/me`
- middleware în `src/app.ts` pentru serializarea sigură a `BigInt` în JSON


### 2.2 De ce au fost alese?

- **Express**: framework minimalist, rapid de pus în funcțiune, potrivit pentru API.
- **TypeScript**: tipizare statică → mai puține bug-uri, IDE support, refactorizare sigură.
- **Prisma**: acces la DB tipizat, query-uri sigure, tranzacții ușor de scris.
- **Supabase Storage**: stocare obiecte (imagini) fără a încărca DB cu blob-uri; scalabil și simplu de integrat.
- **OpenAPI + Swagger UI**: documentare și testare rapidă a endpoint-urilor.
- **JWT**: autentificare stateless (ușor de integrat cu frontend-uri multiple).
- **Multer (memory storage)**: upload multipart/form-data simplu; fișierul este ținut în memorie pentru a fi trimis direct la Supabase.


### 2.3 Arhitectura aplicației (module și interacțiuni)

#### Componente principale
1) **Entry point / server**: `src/app.ts`
- configurează Express (`json`, `urlencoded`)
- adaugă middleware pentru BigInt-safe JSON
- servește Swagger UI pe `/docs` și spec pe `/openapi.yaml`
- atașează router-ul principal `src/routes/index.ts`

2) **Routing**: `src/routes/index.ts`
- agregă rutele pe module:
  - `/auth` → `src/routes/auth.ts`
  - `/users` → `src/routes/users.ts`
  - `/images` → `src/routes/images.ts`
  - `/filters` → `src/routes/filters.ts`
  - `/plans` → `src/routes/plans.ts`
  - `/watermarks` → `src/routes/watermarks.ts`
  - `/reports` → `src/routes/reports.ts`
  - `/payments` → `src/routes/payments.ts`
- definește `/me` protejat cu `requireAuth`

3) **Controllers**: `src/controllers/*`
- parsing/validare input (ex: `userId` uuid, `planId` int, intensitate 0..100)
- aleg status codes (400/401/403/404/409/201/204 etc.)
- apelează modele și întorc răspunsul

4) **Models (data access + logică de domeniu)**: `src/models/*`
- folosesc `PrismaClient` din `src/config/db.ts`
- conțin tranzacții DB pentru operații compuse (ex: aplicare filtru → creare versiune + linkuri + cleanup)

5) **Config**:
- `src/config/db.ts` → PrismaClient
- `src/config/auth.ts` → `JWT_SECRET`, `JWT_EXPIRES_IN`
- `src/config/supabase.ts` → client Supabase și helpers upload/delete/publicUrl

6) **Middleware**:
- `src/middleware/auth.ts` → parse Bearer token, verify JWT, populate `req.auth`

7) **Persistență (DB) + Storage**:
- DB: Postgres (tabele mapate în `prisma/schema.prisma`)
- Storage: Supabase bucket `ppaw`

#### Flux (exemplu) – upload imagine
1. Client → `POST /images/upload` cu `multipart/form-data` (`file`, `userId`)
2. Controller `uploadController.ts`:
   - validează userId & fișier
   - citește plan limits (`getUserUploadLimits`) și usage curent (`getUserCurrentMonthUsage`)
   - dacă depășește, răspunde 403
   - upload buffer în Supabase Storage
   - salvează record în DB (`Image`)
3. Răspuns 201 cu obiectul imaginii

#### Flux (exemplu) – aplicare filtre și istoric
- `POST /images/:imageId/filters` → creează un `ImageVersion` nou + `ImageFilter` linkuri
- istoricul versiunilor rămâne (pentru audit/rollback), dar linkurile „active” sunt păstrate doar pentru ultima versiune


## 3) Implementare

### 3.1 Business layer (explicat)
În proiect, „business layer”-ul este împărțit practic între controllere și modele:

#### a) Controllers (orchestrare + validare)
Exemple de responsabilități:
- validare input (uuid, int, string non-empty)
- reguli de acces la endpoint (ex: `/me` necesită JWT)
- transformări/compatibilitate (ex: suport pentru request body legacy la filtre)
- mapare erori la status codes:
  - 400: input invalid
  - 401: auth invalidă
  - 403: acces interzis (feature/limită)
  - 404: resursă inexistentă
  - 409: conflict (ex: fără abonament activ)

#### b) Models (logică de domeniu + DB)
Aici este logica cea mai „business” și atomică:

1) **Plan/abonament implicit (Free) la crearea userului**
- `createUserProfile()` creează user + atașează automat un subscription activ la planul Free
- planul Free este căutat întâi la `id=1`, apoi după `name="Free"`

2) **Quota pe lună (uploads)**
- limitele sunt extrase din `SubscriptionPlan.limitsJson` (ex: `max_storage_mb`, `max_images_month`)
- utilizarea curentă se calculează din tabela `Image` în fereastra lunii curente
- controllerul refuză upload-ul dacă se depășește (403)

3) **Control acces filtre**
- filtrele permise sunt legate de plan prin tabela pivot `subscription_plan_filters`
- `canUserUseFilter` verifică dacă există abonament activ + link plan-filter

4) **Filtre + versiuni (ImageVersion)**
- fiecare aplicare creează o nouă versiune (`ImageVersion`) cu metadata (stack de filtre)
- linkurile `ImageFilter` sunt păstrate doar pentru ultima versiune (pentru „latest state”), dar istoricul rămâne în `ImageVersion`

5) **Watermarks + versiuni**
- preseturi watermark sunt în tabela `Watermark`
- aplicarea watermark creează `ImageVersion` nou și copiază forward watermark-urile existente, apoi adaugă unul nou cu `sortOrder`
- „latest placements” sunt menținute prin ștergerea plasărilor din versiunile mai vechi

6) **Payments (simulare checkout)**
- `fakeCheckout` simulează un proces de plată:
  - validare număr card cu algoritmul Luhn
  - verificare expirare
  - cazuri de test (ex: card terminat cu `0002` → declined, `cvc=000` → declined)
  - în cazul eșecului, se creează totuși un `Payment` cu status `failed`
  - în cazul succesului și dacă există planId, se creează abonament activ și un `Payment` `succeeded`

7) **Reports (agregări + trends)**
- `generateActivityReport` calculează intervale (day/week/month/year) în UTC
- rulează agregări și groupBy pe tabele (users, images, filters, watermarks, purchases, payments)
- salvează rezultatul în tabela `Report` ca JSON (`data`)


### 3.2 Librării suplimentare utilizate
Dependențe runtime (principale):
- `express` – server HTTP
- `dotenv` – încărcare variabile de mediu
- `@prisma/client` – ORM client
- `@supabase/supabase-js` – acces la Supabase Storage
- `multer` – upload multipart/form-data
- `jsonwebtoken` – semnare/verificare JWT
- `bcryptjs` – hash parolă
- `js-yaml` – parsare `openapi.yaml`

Dependențe dev:
- `typescript`, `ts-node`
- `prisma` (CLI pentru generate)
- `swagger-ui-express`
- pachete `@types/*`


### 3.3 Secțiuni de cod / abordări deosebite

1) **BigInt-safe JSON**
În `src/app.ts`, răspunsurile JSON sunt „sanitize” astfel încât `bigint` să fie convertit în string (altfel `JSON.stringify` ar arunca eroare). Asta e util deoarece DB are câmpuri precum `sizeBytes` (Postgres bigint).

2) **Istoric + stare curentă prin versiuni**
Atât la filtre, cât și la watermarks, se folosește modelul:
- „istoric” = tabelele de versiuni (`image_versions`) rămân
- „stare curentă” = linkurile pentru ultima versiune (image_filters / image_version_watermarks) sunt menținute ca „latest” prin cleanup

3) **Limits/Features configurabile prin JSON în plan**
Planul are:
- `limitsJson` (quota)
- `featuresJson` (ex: watermark, ai_enhancement)

Această abordare permite extinderea fără schimbări frecvente de schemă (dar necesită validare atentă).

4) **Compatibilitate input (filter apply)**
Controllerul de filtre acceptă atât formatul nou (ex: `filterId` poate fi number sau array), cât și un format legacy `filters: [{filterId,intensity}]`.


## 4) Utilizare

### 4.1 Pașii de instalare – pentru programator (developer)

#### Precondiții
- Node.js recomandat: 20+
- Postgres (local sau Supabase Postgres)
- Supabase Storage bucket: `ppaw`

#### Instalare
1) Instalare pachete:
```bash
npm install
```

2) Configurare variabile de mediu:
- copiază `.env.example` în `.env`
- completează minim:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (recomandat)

3) Pregătire bază de date
Repo-ul nu include Prisma migrations, deci se aplică scripturile SQL:
- rulează fișierele din `prisma/sql/` în ordine cronologică (după prefixul cu dată)

4) Generează Prisma client:
```bash
npm run prisma:generate
```

5) (Opțional) test conectivitate DB:
```bash
npm run db:test
```

6) Rulează în development:
```bash
npm run dev
```

7) Verifică în browser:
- `http://localhost:3000/docs`


### 4.2 Pașii de instalare – la beneficiar (deployment)

Scop: rulare stabilă, pe un server (Windows/Linux), cu DB și env setate.

1) Pregătește runtime:
- Node.js LTS instalat
- acces la Postgres (ex: Supabase) și bucket Supabase Storage

2) Configurează variabilele de mediu:
- setează variabilele din `.env` (în mod preferat prin environment variables ale sistemului / secret manager)
- `JWT_SECRET` trebuie să fie un secret puternic

3) Build + run:
```bash
npm install
npm run build
npm start
```

4) Recomandări operaționale:
- rulează în spatele unui reverse proxy (Nginx/IIS) dacă expui public
- configurează HTTPS la nivel de proxy
- folosește un process manager (PM2) pentru restart automat (dacă e permis în setup-ul beneficiarului)


### 4.3 Mod de utilizare (API)

#### a) Documentație și testare
- deschide Swagger UI: `GET /docs`
- poți testa endpoint-urile direct din interfață

#### b) Autentificare
1) `POST /auth/register` (email, password, opțional name/avatarUrl)
2) `POST /auth/login`
- răspuns: `{ token, user }`
3) pentru endpoint-uri protejate: header
- `Authorization: Bearer <token>`

Notă: în implementarea curentă, doar `/me` este protejat prin middleware. Alte endpoint-uri folosesc `userId` în parametri/body (bun pentru demo/local testing; pentru producție ar trebui corelat `userId` cu `req.auth.userId`).

#### c) Flux recomandat (exemplu end-to-end)
1) Creează user (prin register sau `POST /users`)
2) Obține planul curent:
- `GET /users/:userId/plan`
3) Verifică quota:
- `GET /users/:userId/quota`
4) Upload imagine:
- `POST /images/upload` multipart/form-data (`file`, `userId`)
5) Listează filtre disponibile:
- `GET /filters` (toate)
- `GET /filters/:userId` (doar permise planului)
6) Aplică filtru pe imagine:
- `POST /images/:imageId/filters`
7) Watermark:
- `POST /watermarks` (creează preset)
- `POST /images/:imageId/watermarks` (aplică)
8) Rapoarte:
- `POST /reports/generate` (global activity, pe perioadă)
- `GET /reports?userId=<uuid>&type=<optional>&limit=<optional>`
9) Plăți / schimbare plan:
- `POST /payments/checkout` (simulat)
- alternativ `PUT /users/:userId/plan` (pentru free sau cu card pentru paid)


## 5) Observații și posibile îmbunătățiri (opțional)
- Autorizare: majoritatea endpoint-urilor ar trebui să verifice că `req.auth.userId` corespunde `userId` din request.
- Migrații: trecerea la Prisma migrations ar standardiza evoluția DB (acum este SQL-first).
- Validări: se poate introduce o librărie de schema validation (ex: Zod) pentru un codebase mai robust.

