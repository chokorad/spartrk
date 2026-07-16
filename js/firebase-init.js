import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  addDoc, query, where, orderBy, getDocs, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBzKO14Iek0KZjF9sbOT36AUW_upivHIOA",
  authDomain: "spartrk.firebaseapp.com",
  projectId: "spartrk",
  storageBucket: "spartrk.firebasestorage.app",
  messagingSenderId: "247510964773",
  appId: "1:247510964773:web:c78d4877d0002956acbdcc"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Fuerza long-polling desde el inicio (sin intentar streaming primero): algunos
// bloqueadores de anuncios / extensiones de privacidad tapan el canal "Listen" en
// streaming por error (ERR_BLOCKED_BY_CLIENT). Con force ya ni siquiera lo intenta.
// ignoreUndefinedProperties: red de seguridad para que un campo "undefined" nunca
// vuelva a tumbar un guardado completo con invalid-argument.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  ignoreUndefinedProperties: true
});

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, query, where, orderBy,
  getDocs, serverTimestamp, Timestamp
};
