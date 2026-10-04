[out:json][timeout:180];
area["name"="臺北市"]["admin_level"="4"]->.tp;
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link)$"](area.tp);
);
out body geom;
