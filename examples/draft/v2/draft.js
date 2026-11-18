const key = "fieldnotes.v2";
const title = document.querySelector("#title");
const body = document.querySelector("#body");
// Read the v1 draft on the first upgrade. Subsequent saves use the v2 key.
const saved = JSON.parse(
  localStorage.getItem(key) ?? localStorage.getItem("fieldnotes.v1") ?? "null",
);

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
