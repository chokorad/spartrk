import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
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
export const db = getFirestore(app);

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup,
  doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, orderBy,
  getDocs, serverTimestamp, Timestamp
};
