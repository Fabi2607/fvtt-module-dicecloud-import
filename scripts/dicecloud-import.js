// Set up the user interface
Hooks.on("renderSidebarTab", async (app, html) => {
    if (app.options.id == "compendium") {
        let button = $("<button class='import-dicecloud'><i class='fas fa-file-import'></i> DiceCloud Import</button>")

        button.click(function () {
            new DiceCloudImporter().render(true);
        });

        html.find(".directory-footer").append(button);
    }
})

// Main module class
class DiceCloudImporter extends Application {
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.id = "dicecloudimporter";
        options.template = "modules/dicecloud-import/templates/dicecloud_import_ui.html"
        options.classes.push("dicecloud-importer");
        options.resizable = false;
        options.height = "auto";
        options.width = 400;
        options.minimizable = true;
        options.title = "DiceCloud Importer"
        return options;
    }

    activateListeners(html) {
        super.activateListeners(html)
        html.find(".import-dicecloud").click(async ev => {
            let dicecloudJSON = html.find('[name=dicecloud-json]').val();
            let updateBool = html.find('[name=updateButton]').is(':checked');
            await DiceCloudImporter.parseCharacter(dicecloudJSON, updateBool)
        });
        this.close();
    }

    static parseAbilities(parsedCharacter) {
        return {
            str: {
                min: 3,
                mod: 0,
                proficient: 0,
                value: 10,
            },
            dex: {
                min: 3,
                mod: 0,
                proficient: 0,
                value: 10,
            },
            con: {
                min: 3,
                mod: 0,
                proficient: 0,
                value: 10,
            },
            int: {
                min: 3,
                mod: 0,
                proficient: 0,
                value: 10,
            },
            wis: {
                min: 3,
                mod: 0,
                proficient: 0,
                value: 10,
            },
            cha: {
                min: 3,
                mod: 0,
                proficient: 0,
                value: 10,
            }
        };
    }

    static parseAttributes(parsedCharacter) {
        return {
            ac: {
                label: "Armor Class",
                type: "Number",
                value: 15
            },
            death: {
                success: 0,
                failure: 0,
            },
            exhaustion: 0,
            hd: 3,
            hp: {
                value: 23,
                min: 0,
                max: 23,
            },
            init: {
                value: 0,
                bonus: 0,
                mod: 4,
            },
            movement: {
                burrow: 0,
                climb: 20,
                fly: 0,
                hover: false,
                swim: 0,
                units: "ft",
                walk: 30,
            },
            senses: {
                blindsight: 0,
                darkvision: 60,
                special: "",
                tremorsense: 0,
                truesight: 0,
                units: "ft"
            },
            speed: {
                special:  "Burrow 0 ft, Climb 20 ft, Fly 0 ft, Swim 0 ft",
                value: "30 ft",
            },
            spellcasting: "",
            spelldc: 10,
        };
    }

    static parseDetails(parsedCharacter) {
        return {
            alignment: "",
            type: "race",
            source: `DiceCloud`
        };
    }

    static parseCurrency(parsedCharacter) {
        return {};
    }

    static parseTraits(parsedCharacter) {
        return {
            size: "med",
            di: {
                value: []
            },
            dr: {
                value: []
            },
            dv: {
                value: []
            },
            ci: {
                value: []
            },
            senses: "",
        };
    }

    static async parseCharacter(characterJSON, updateBool) {
        // Parse CritterDB JSON data pasted in UI
        // Determine if this is a single monster or a bestiary by checking for creatures array
        let parsedCharacter = JSON.parse(characterJSON);
        // console.log(updateBool)

        // Dictionary to map monster size strings
        let size_dict = {
            "Tiny": "tiny",
            "Small": "sm",
            "Medium": "med",
            "Large": "lrg",
            "Huge": "huge",
            "Gargantuan": "grg"
        };

        // Find image if present
        let img_url = "icons/svg/mystery-man.png";

        // Create the temporary actor data structure
        let tempActor = {
            name: parsedCharacter.name,
            type: "character",
            img: img_url,
            token: {
                name: parsedCharacter.name,
                img: img_url
            },
            data: {
                abilities: DiceCloudImporter.parseAbilities(parsedCharacter),
                attributes: DiceCloudImporter.parseAttributes(parsedCharacter),
                currency: DiceCloudImporter.parseCurrency(parsedCharacter),
                details: DiceCloudImporter.parseDetails(parsedCharacter),
                traits: DiceCloudImporter.parseTraits(parsedCharacter),
                items: []
            },
            items: [],
        };

        // Create owned "Items" for spells, actions, and abilities
        // WIP: Loop over the critterDB stats.additionalAbilities, actions, reactions, and legendaryActions
        // to generate Foundry "items" for attacks/spells/etc

        console.log(tempActor);

        // Check if this actor already exists and handle update/replacement
        let existingActor = null;

        if (existingActor == null) {
            let thisActor = await Actor.create(tempActor, {'temporary': false, 'displaySheet': false});

            // Wrap up
            console.log(`Done importing ${c.name} into ${pack.collection}`);
            ui.notifications.info(`Done importing ${c.name} into ${pack.collection}`);
        } else if (updateBool == true) {
            // Need to pass _id to updateEntity
            tempActor._id = existingActor._id;

            // Don't update image or token in case these have been modified in Foundry
            // Could make this a check box later?
            delete tempActor.img;
            delete tempActor.token;

            await pack.updateEntity(tempActor);
            console.log(`Updated ${c.name} in ${pack.collection}`);
            ui.notifications.info(`Updated data for ${c.name} in ${pack.collection}`);
        } else {
            console.log(`${c.name} already exists. Skipping`);
            ui.notifications.error(`${c.name} already exists. Skipping`);
        }
        await pack.getIndex(); // Need to refresh the index to update it
    }
}
