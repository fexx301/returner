const key = "fieldnotes.v2";
const title = document.querySelector("#title");
const body = document.querySelector("#body");
const saved = JSON.parse(localStorage.getItem(key) || "null");

if (saved) {
  title.value = saved.title;
  body.value = saved.body;
}

document.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem(
    key,
    JSON.stringify({ title: title.value, body: body.value }),
  );
  document.querySelector("output").textContent = "Draft saved";
});
