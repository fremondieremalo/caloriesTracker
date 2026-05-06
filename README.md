# CalTrack — Suivi Calorique Personnel

Site web de suivi calorique avec sync cloud Firebase Firestore.

## Fichiers

```
calorie-tracker/
├── index.html          → Page principale
├── style.css           → Styles
├── app.js              → Logique + sync Firebase
├── firebase-config.js  → ⚠️ Config Firebase (à remplir)
└── README.md
```

---

## ÉTAPE 1 — Configurer Firebase (sync cloud)

### 1.1 Créer le projet Firebase

1. Va sur **https://console.firebase.google.com**
2. Clique **"Ajouter un projet"**
3. Donne-lui un nom (ex: `caltrack`) et suis les étapes
4. Désactive Google Analytics si tu veux (pas nécessaire)

### 1.2 Créer la base de données Firestore

1. Dans le menu gauche → **"Firestore Database"**
2. Clique **"Créer une base de données"**
3. Choisis **"Démarrer en mode production"**
4. Sélectionne une région proche (ex: `europe-west3` pour Frankfurt)

### 1.3 Configurer les règles Firestore (accès sans auth)

Dans Firestore → onglet **"Règles"**, remplace tout par :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /days/{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ Ces règles donnent accès à tout le monde. C'est OK car le site est uniquement pour toi et non indexé, mais si tu veux plus de sécurité, tu peux ajouter une authentification Firebase plus tard.

### 1.4 Récupérer la config Firebase

1. Dans Firebase → ⚙️ **"Paramètres du projet"** → onglet **"Général"**
2. Descends jusqu'à **"Tes applications"**
3. Clique **"</>  Web"**, entre un nom (ex: `caltrack-web`), clique **"Enregistrer l'application"**
4. Copie l'objet `firebaseConfig` qui apparaît

### 1.5 Coller la config dans le projet

Ouvre **`firebase-config.js`** et remplace les valeurs :

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "caltrack-xxxx.firebaseapp.com",
  projectId:         "caltrack-xxxx",
  storageBucket:     "caltrack-xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abcdef"
};
```

---

## ÉTAPE 2 — Déployer sur GitHub Pages

### Dans le terminal VSCode :

```bash
# 1. Se placer dans le dossier
cd calorie-tracker

# 2. Initialiser Git
git init
git add .
git commit -m "Initial commit — CalTrack avec Firebase"

# 3. Créer le repo sur github.com/new (sans README, sans .gitignore)
#    puis relier et pousser :
git remote add origin https://github.com/TON_PSEUDO/calorie-tracker.git
git branch -M main
git push -u origin main

# 4. Activer GitHub Pages :
#    → Settings → Pages → Source: "Deploy from branch"
#    → Branch: main / root → Save
#    Ton site : https://TON_PSEUDO.github.io/calorie-tracker
```

### Mises à jour futures :

```bash
git add .
git commit -m "Mise à jour"
git push
```

---

## Fonctionnement de la sync

- Les données sont **synchronisées en temps réel** entre tous tes appareils via Firestore
- Un cache local est maintenu : le site **fonctionne hors ligne** et synchronise au retour de la connexion
- La barre en haut indique l'état : 🟢 synchronisé · 🟡 en cours · 🔴 hors ligne

## Modifier le métabolisme de base

Dans `app.js`, ligne 1 : `const BMR = 1800;`
